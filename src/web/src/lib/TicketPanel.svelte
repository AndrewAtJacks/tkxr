<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { Sprint, Ticket, TicketComment, User } from './stores';
  import { avatarColorFor, initials, PRIORITY_META, relativeTime, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from './util';
  import { copyPrompt, copyToClipboard, showToast } from './clipboard';
  import { ticketAskPrompt, workOnTicketPrompt } from './prompts';
  import X from './icons/X.svelte';
  import Sparkles from './icons/Sparkles.svelte';

  export let ticket: Ticket | null = null;
  export let isCreate = false;
  export let sprints: Sprint[] = [];
  export let users: User[] = [];
  export let defaultSprint: string | null = null;
  export let defaultAssignee: string | null = null;

  const dispatch = createEventDispatcher();

  // Initialize draft once from the ticket (or create defaults). Parent uses {#key selectedTicketId}
  // to re-mount the panel on ticket change, so no reactive reset is needed — and having one
  // would clobber the user's in-flight edits every time an unrelated WS event triggers reload().
  let draft: Partial<Ticket> = ticket && !isCreate
    ? { ...ticket }
    : {
        type: 'task',
        title: '',
        description: '',
        priority: 'medium',
        status: 'backlog',
        assignee: defaultAssignee || null,
        sprint: defaultSprint || null,
        estimate: 1,
      };

  let comments: TicketComment[] = [];
  let commentDraft = '';
  let askInput = '';
  let saveTimer: number | null = null;

  const ASK_PRESETS = [
    { label: 'Break into subtasks', text: 'Break this ticket into concrete subtasks. If it makes sense, create them as new tickets linked to this one via a "parent" label.' },
    { label: 'Estimate effort', text: 'Estimate story points for this ticket. Read the description carefully and check the repo if needed. Set the estimate via edit_ticket if you\'re confident.' },
    { label: 'Summarize', text: 'Summarize the current state of this ticket in 2–3 sentences: what it is, where it stands, what\'s blocking or next.' },
    { label: 'Investigate + comment', text: 'Investigate this ticket against the actual repo. Post your findings as a comment via add_comment.' },
  ];

  function copyAsk(prompt: string) {
    if (!ticket) return;
    const text = ticketAskPrompt(prompt, ticket, users, sprints);
    copyPrompt(text);
  }
  function copyAskFromInput() {
    const text = askInput.trim();
    if (!text) return;
    copyAsk(text);
    askInput = '';
  }
  function copyWorkOn() {
    if (!ticket) return;
    copyPrompt(workOnTicketPrompt(ticket, users, sprints));
  }

  let worktreeBusy = false;

  async function createWorktree() {
    if (!ticket || worktreeBusy) return;
    worktreeBusy = true;
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/worktree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.ticket) {
          ticket = j.ticket;
          draft.worktree = j.ticket.worktree;
        }
        showToast('Worktree created', 'success');
        dispatch('reload');
      } else {
        const j = await res.json().catch(() => ({}));
        showToast(j.error || 'Failed to create worktree', 'error', 4000);
      }
    } catch (err) {
      showToast('Failed to create worktree', 'error');
    } finally {
      worktreeBusy = false;
    }
  }

  async function removeWorktreeAction(force = false) {
    if (!ticket || worktreeBusy) return;
    if (!confirm('Remove the worktree? The branch will be deleted too (uncommitted work will be lost if you skip force + the tree is dirty).')) return;
    worktreeBusy = true;
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/worktree${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const j = await res.json();
        if (j.ticket) {
          ticket = j.ticket;
          draft.worktree = null;
        }
        showToast('Worktree removed', 'success');
        dispatch('reload');
      } else {
        const j = await res.json().catch(() => ({}));
        const msg = j.error || 'Failed to remove worktree';
        if (!force && /uncommitted|locked|dirty/i.test(msg)) {
          if (confirm(`${msg}\n\nForce remove?`)) {
            worktreeBusy = false;
            return removeWorktreeAction(true);
          }
        }
        showToast(msg, 'error', 4000);
      }
    } catch (err) {
      showToast('Failed to remove worktree', 'error');
    } finally {
      worktreeBusy = false;
    }
  }

  async function copyCd() {
    if (!ticket?.worktree) return;
    const ok = await copyToClipboard(`cd "${ticket.worktree.path}"`);
    showToast(ok ? 'Copied cd command' : 'Copy failed', ok ? 'success' : 'error');
  }

  onMount(async () => {
    if (ticket && !isCreate) await loadComments();
  });

  async function loadComments() {
    if (!ticket) return;
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/comments`);
      if (res.ok) comments = await res.json();
    } catch { /* noop */ }
  }

  function schedulePatch(patch: any) {
    if (!ticket || isCreate) return;
    // optimistic local
    Object.assign(ticket, patch);
    ticket = { ...ticket };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/tickets/${ticket!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) dispatch('reload');
      } catch { /* noop */ }
    }, 300);
  }

  async function commitCreate() {
    if (!draft.title || !draft.title.trim()) return;
    try {
      const body: any = {
        type: draft.type,
        title: draft.title.trim(),
        description: draft.description,
        priority: draft.priority,
        estimate: draft.estimate,
      };
      if (draft.assignee) body.assignee = draft.assignee;
      if (draft.sprint) body.sprint = draft.sprint;
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      const created = await res.json();
      if (draft.status && draft.status !== 'backlog') {
        await fetch(`/api/tickets/${created.id}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: draft.status }),
        });
      }
      dispatch('reload');
      dispatch('close');
    } catch { /* noop */ }
  }

  async function deleteTicket() {
    if (!ticket) return;
    if (!confirm('Delete this ticket?')) return;
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
      if (res.ok) {
        dispatch('reload');
        dispatch('close');
      }
    } catch { /* noop */ }
  }

  async function sendComment() {
    if (!ticket) return;
    const content = commentDraft.trim();
    if (!content) return;
    const author = users[0]?.id || 'anon';
    try {
      const res = await fetch(`/api/tickets/${ticket.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, author }),
      });
      if (res.ok) {
        commentDraft = '';
        await loadComments();
      }
    } catch { /* noop */ }
  }

  function usernameById(id?: string | null): string {
    if (!id) return 'unknown';
    return users.find(u => u.id === id)?.displayName || id;
  }
  function userMeta(id?: string | null) {
    if (!id) return null;
    const idx = users.findIndex(u => u.id === id);
    return idx >= 0 ? { user: users[idx], index: idx } : null;
  }

  $: prio = draft.priority ? PRIORITY_META[draft.priority as any] : null;
</script>

<header class="head">
  <span class="mono id">{isCreate ? 'NEW TICKET' : ticket?.id}</span>
  {#if prio}
    <span class="prio" style="background:{prio.bg};color:{prio.color}">{prio.label}</span>
  {/if}
  <button class="close" on:click={() => dispatch('close')} title="Close"><X size={16} /></button>
</header>

<div class="body">
  <textarea
    class="ttl"
    placeholder="Ticket title"
    bind:value={draft.title}
    on:input={() => !isCreate && schedulePatch({ title: draft.title })}
  ></textarea>

  <div class="meta">
    <span class="label">Type</span>
    <div class="segmented">
      <button class:active={draft.type === 'task'} on:click={() => { draft.type = 'task'; if (!isCreate) schedulePatch({ type: 'task' }); }}>Task</button>
      <button class:active={draft.type === 'bug'} on:click={() => { draft.type = 'bug'; if (!isCreate) schedulePatch({ type: 'bug' }); }}>Bug</button>
    </div>

    <span class="label">Status</span>
    <div class="segmented wrap">
      {#each STATUS_ORDER as s}
        <button
          class:active={draft.status === s}
          style={draft.status === s ? `border-color:${STATUS_COLOR[s]};color:${STATUS_COLOR[s]}` : ''}
          on:click={async () => {
            draft.status = s;
            if (!isCreate && ticket) {
              try {
                await fetch(`/api/tickets/${ticket.id}/status`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: s }),
                });
                dispatch('reload');
              } catch { /* noop */ }
            }
          }}
        >{STATUS_LABEL[s]}</button>
      {/each}
    </div>

    <span class="label">Priority</span>
    <select
      class="input"
      bind:value={draft.priority}
      on:change={() => !isCreate && schedulePatch({ priority: draft.priority })}
    >
      <option value="low">Low</option>
      <option value="medium">Medium</option>
      <option value="high">High</option>
      <option value="critical">Critical</option>
    </select>

    <span class="label">Assignee</span>
    <select
      class="input"
      value={draft.assignee || ''}
      on:change={(e) => {
        const v = e.currentTarget.value || null;
        draft.assignee = v;
        if (!isCreate) schedulePatch({ assignee: v });
      }}
    >
      <option value="">Unassigned</option>
      {#each users as u}
        <option value={u.id}>{u.displayName}</option>
      {/each}
    </select>

    <span class="label">Sprint</span>
    <select
      class="input"
      value={draft.sprint || ''}
      on:change={(e) => {
        const v = e.currentTarget.value || null;
        draft.sprint = v;
        if (!isCreate) schedulePatch({ sprint: v });
      }}
    >
      <option value="">No sprint</option>
      {#each sprints as s}
        <option value={s.id}>{s.name}</option>
      {/each}
    </select>

    <span class="label">Estimate</span>
    <input
      class="input est"
      type="number"
      min="0"
      value={draft.estimate ?? ''}
      on:input={(e) => {
        const v = e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value);
        draft.estimate = v;
        if (!isCreate) schedulePatch({ estimate: v });
      }}
    />
  </div>

  <div>
    <div class="label" style="margin-bottom:6px">Description</div>
    <textarea
      class="desc"
      placeholder="Describe the ticket…"
      bind:value={draft.description}
      on:input={() => !isCreate && schedulePatch({ description: draft.description })}
    ></textarea>
  </div>

  {#if !isCreate && ticket}
    <div class="wt-card">
      <div class="wt-head">
        <span class="wt-label">Worktree</span>
        {#if ticket.worktree}
          <span class="wt-badge">active</span>
        {/if}
      </div>
      {#if ticket.worktree}
        <div class="wt-rows">
          <div class="wt-row"><span class="wt-k">Path</span><span class="wt-v mono">{ticket.worktree.path}</span></div>
          <div class="wt-row"><span class="wt-k">Branch</span><span class="wt-v mono">{ticket.worktree.branch}</span></div>
        </div>
        <div class="wt-actions">
          <button class="btn" on:click={copyCd} disabled={worktreeBusy}>Copy cd</button>
          <button class="btn btn-danger" on:click={() => removeWorktreeAction(false)} disabled={worktreeBusy}>Remove worktree</button>
        </div>
      {:else}
        <div class="wt-hint">Isolate concurrent work in its own git worktree + branch. Path defaults to <code>../&lt;repo&gt;-worktrees/{ticket.id}</code>, branch to <code>tkxr/{ticket.id}</code>.</div>
        <button class="btn btn-primary" on:click={createWorktree} disabled={worktreeBusy}>Create worktree</button>
      {/if}
    </div>

    <div class="ai-card">
      <div class="ai-head">
        <Sparkles size={14} color="var(--ai)" />
        <span>Hand this ticket to an agent</span>
      </div>
      <div class="ai-hint">Copies a prompt (ticket JSON + tkxr MCP reminder) to your clipboard. Paste into Claude Code.</div>

      <button class="work-btn" on:click={copyWorkOn}>
        <Sparkles size={14} color="#fff" />
        <span>Work on this</span>
      </button>

      <div class="ai-hint" style="margin-top:2px">Or a narrower question:</div>
      <div class="ai-chips">
        {#each ASK_PRESETS as p}
          <button class="ai-chip" on:click={() => copyAsk(p.text)}>{p.label}</button>
        {/each}
      </div>
      <div class="ai-input">
        <input
          class="input"
          placeholder="Custom question — copies as a prompt…"
          bind:value={askInput}
          on:keydown={(e) => e.key === 'Enter' && copyAskFromInput()}
        />
        <button class="btn" on:click={copyAskFromInput} disabled={!askInput.trim()}>Copy prompt</button>
      </div>
    </div>

    <div class="comments">
      <div class="comments-head">
        <span>Comments · {comments.length}</span>
      </div>
      {#each comments as c}
        {@const meta = userMeta(c.author)}
        <div class="comment">
          {#if meta}
            <span class="c-avatar" style="background:{avatarColorFor(meta.user, meta.index)}">{initials(meta.user.displayName)}</span>
          {:else}
            <span class="c-avatar" style="background:var(--chip)">?</span>
          {/if}
          <div class="c-body">
            <div class="c-meta">
              <span class="c-name">{usernameById(c.author)}</span>
              <span class="c-time">{relativeTime(c.createdAt)}</span>
            </div>
            <div class="c-content">{c.content}</div>
          </div>
        </div>
      {/each}
      <div class="c-input">
        <input class="input" placeholder="Add a comment…" bind:value={commentDraft} on:keydown={(e) => e.key === 'Enter' && sendComment()} />
        <button class="btn" on:click={sendComment}>Send</button>
      </div>
    </div>
  {/if}
</div>

<footer class="foot">
  {#if isCreate}
    <button class="btn" on:click={() => dispatch('close')}>Cancel</button>
    <button class="btn btn-primary" on:click={commitCreate}>Create ticket</button>
  {:else}
    <button class="btn btn-danger" on:click={deleteTicket}>Delete</button>
    <span class="foot-hint">Edits save automatically</span>
  {/if}
</footer>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .id {
    font-family: 'IBM Plex Mono';
    font-size: 11px;
    color: var(--faint);
    flex: 1;
  }
  .prio {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 5px;
  }
  .close {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 5px;
  }
  .close:hover { background: var(--surface-hover); color: var(--text); }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .ttl {
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 19px;
    font-weight: 600;
    outline: none;
    resize: none;
    min-height: 32px;
    padding: 0;
    font-family: inherit;
  }
  .meta {
    display: grid;
    grid-template-columns: 74px 1fr;
    align-items: center;
    gap: 10px 14px;
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    flex-wrap: nowrap;
  }
  .segmented.wrap { flex-wrap: wrap; }
  .segmented > button {
    padding: 5px 9px;
    background: transparent;
    color: var(--muted);
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }
  .segmented > button.active {
    background: var(--chip);
    color: var(--text);
    font-weight: 600;
  }
  .est { width: 88px; }
  .desc {
    background: var(--surface-hover);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    font-size: 12.5px;
    color: var(--text);
    outline: none;
    resize: vertical;
    min-height: 80px;
    width: 100%;
    font-family: inherit;
  }
  .desc:focus { border-color: var(--accent); }

  .wt-card {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .wt-head { display: flex; align-items: center; gap: 8px; }
  .wt-label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .wt-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(70,193,127,.14);
    color: #46c17f;
  }
  .wt-hint { font-size: 11.5px; color: var(--muted); line-height: 1.4; }
  .wt-hint code {
    background: var(--surface);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 10.5px;
  }
  .wt-rows { display: flex; flex-direction: column; gap: 4px; }
  .wt-row { display: flex; gap: 8px; align-items: baseline; }
  .wt-k {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .04em;
    text-transform: uppercase;
    color: var(--faint);
    width: 46px;
    flex: none;
  }
  .wt-v {
    flex: 1;
    font-size: 11.5px;
    color: var(--text2);
    word-break: break-all;
  }
  .wt-actions { display: flex; gap: 6px; flex-wrap: wrap; }

  .ai-card {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ai-head {
    display: flex; align-items: center; gap: 6px;
    font-size: 12.5px;
    color: var(--text2);
    font-weight: 600;
  }
  .ai-hint { font-size: 11px; color: var(--faint); line-height: 1.4; }
  .work-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 12px;
    background: linear-gradient(135deg, #4c8dff, #6b5bff);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity .12s;
  }
  .work-btn:hover { opacity: .9; }
  .ai-chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .ai-chip {
    padding: 4px 8px;
    background: rgba(107,91,255,.1);
    color: var(--ai-text);
    border: none;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
  }
  .ai-chip:hover { background: rgba(107,91,255,.18); }
  .ai-thread {
    display: flex; flex-direction: column; gap: 6px;
    max-height: 220px;
    overflow-y: auto;
  }
  .ai-msg {
    padding: 7px 10px;
    border-radius: 8px;
    font-size: 12px;
    max-width: 85%;
    white-space: pre-wrap;
  }
  .ai-msg.user {
    background: var(--surface-3);
    color: var(--text);
    align-self: flex-end;
  }
  .ai-msg.assistant {
    background: rgba(107,91,255,.08);
    color: var(--ai-msg);
    align-self: flex-start;
  }
  .ai-msg.thinking { animation: pulse 1.2s infinite; }
  .ai-input { display: flex; gap: 6px; }
  .ai-input .input { flex: 1; }

  .comments { display: flex; flex-direction: column; gap: 10px; }
  .comments-head {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .comment { display: flex; gap: 8px; }
  .c-avatar {
    width: 24px; height: 24px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px;
    font-weight: 600;
    color: #0b0e12;
    flex: none;
  }
  .c-body { flex: 1; }
  .c-meta { display: flex; gap: 8px; align-items: baseline; }
  .c-name { font-size: 12px; font-weight: 600; color: var(--text); }
  .c-time { font-size: 10.5px; color: var(--faint); }
  .c-content { font-size: 12.5px; color: var(--text2); margin-top: 2px; white-space: pre-wrap; }
  .c-input { display: flex; gap: 6px; }
  .c-input .input { flex: 1; }

  .foot {
    padding: 12px 18px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }
  .foot-hint {
    font-size: 10.5px;
    color: var(--faint);
  }
</style>
