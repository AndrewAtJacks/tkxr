<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { Epic, Sprint, Ticket, User } from './stores';
  import { normalizeTicket } from './util';
  import { onTicketEvent } from './ticketEvents';
  import { claudeAvailable } from './settings';
  import { runPrompt } from './claudeRun';
  import { epicBreakdownPrompt, epicReviewPrompt } from './prompts';
  import { copyToClipboard, showToast } from './clipboard';
  import BranchInsights from './BranchInsights.svelte';
  import CopyId from './CopyId.svelte';
  import Sparkles from './icons/Sparkles.svelte';
  import X from './icons/X.svelte';

  export let epic: Epic | null = null;
  export let isCreate = false;
  /** Sprint (workspace) the epic belongs to — new epics default into it. */
  export let sprintId: string | null = null;
  /** All sprints — backs the "move this epic to another workspace" selector. */
  export let sprints: Sprint[] = [];
  /** Reference data for the planning prompt — never auto-assigned from. */
  export let users: User[] = [];

  const dispatch = createEventDispatcher();

  const EPIC_COLORS = ['#4c8dff', '#6b5bff', '#46c17f', '#f2b544', '#e5687f', '#3fb6c9', '#b57edc'];

  let draft: Partial<Epic> = epic && !isCreate
    ? { ...epic }
    : { name: '', description: '', goal: '', status: 'active', color: EPIC_COLORS[0], sprint: sprintId };

  let saveTimer: number | null = null;

  function setStatus(v: string) {
    draft.status = v as Epic['status'];
    if (!isCreate) schedulePatch({ status: draft.status });
  }

  // Moving an epic between workspaces. `''` maps to the Unsorted workspace
  // (no sprint), which the server stores as an absent `sprint` field.
  //
  // Patching `epic.sprint` alone moves the record and leaves its tickets in the
  // old workspace — the epic then renders under a sprint holding none of its
  // work. So by default the tickets come along, via the bulk move endpoint
  // (which re-parents the epic itself as part of the same call). Unticking the
  // box is the deliberate "just re-file the epic" case (tas-vEpBfx0t).
  let moveTicketsWithEpic = true;
  let sprintMoveBusy = false;

  async function setSprint(v: string) {
    const target = v || null;
    // The select is one-way bound to `draft.sprint`, so the optimistic write is
    // what keeps it on the picked option while the move is in flight. Nothing
    // moved if the request fails, so put it back — otherwise the panel claims a
    // workspace the epic isn't in until it's closed and reopened.
    const prevSprint = draft.sprint;
    draft.sprint = v || undefined;
    if (isCreate || !epic) return;

    if (!moveTicketsWithEpic || scoped.length === 0) {
      // `schedulePatch` keeps failed fields in `pending` and retries them on the
      // next edit, so its own optimism is deliberate — leave it alone.
      schedulePatch({ sprint: target });
      return;
    }

    sprintMoveBusy = true;
    try {
      const res = await fetch('/api/tickets/bulk/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromEpic: epic.id, toSprint: target, moveEpic: true }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        if (j.epic) epic = j.epic;
        const label = target === null
          ? 'Unsorted'
          : (sprints.find(s => s.id === target)?.name || 'the target sprint');
        showToast(`Epic and ${j.moved} ticket${j.moved === 1 ? '' : 's'} moved to ${label}`, 'success');
        await fetchEpicTickets();
        dispatch('reload');
      } else {
        draft.sprint = prevSprint;
        showToast(j.error?.message || 'Failed to move the epic', 'error', 4000);
      }
    } catch {
      draft.sprint = prevSprint;
      showToast('Failed to move the epic', 'error');
    } finally {
      sprintMoveBusy = false;
    }
  }

  // The board's ticket store is workspace-scoped, epic-filtered and paged, so
  // it can't back these numbers — filtering to epic B and opening epic A's
  // panel would render A as empty. Fetch our own slice instead, the way
  // SprintPanel does (tas-hr2pCGjr).
  let scoped: Ticket[] = [];
  let scopedAbort: AbortController | null = null;

  $: totalPts = scoped.reduce((s, t) => s + (t.estimate || 0), 0);
  $: donePts = scoped.filter(t => t.status === 'done').reduce((s, t) => s + (t.estimate || 0), 0);

  async function fetchEpicTickets() {
    if (!epic || isCreate) return;
    if (scopedAbort) scopedAbort.abort();
    const ac = new AbortController();
    scopedAbort = ac;
    try {
      const res = await fetch(`/api/tickets?epic=${encodeURIComponent(epic.id)}&limit=200`, { signal: ac.signal });
      if (!res.ok) return;
      const j = await res.json();
      const items: any[] = Array.isArray(j) ? j : (j.items || []);
      scoped = items.map(normalizeTicket);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      // noop — panel stays usable with stale data
    } finally {
      if (scopedAbort === ac) scopedAbort = null;
    }
  }

  onMount(() => {
    fetchEpicTickets();
    // Keep the list live for as long as the panel is open; the shared bus
    // closes the socket once the last subscriber unsubscribes.
    const off = onTicketEvent(() => fetchEpicTickets());
    return () => {
      off();
      if (scopedAbort) scopedAbort.abort();
    };
  });

  // Coalesce into one pending patch rather than replacing it. Each call used to
  // clear the timer and re-arm it closed over its *own* patch, so two edits
  // inside the 300ms window sent only the second — while `Object.assign` had
  // already applied both locally, so the panel showed the lost one as saved
  // until a reload silently reverted it (bug-7bVl3-Kj).
  let pending: any = {};

  function schedulePatch(patch: any) {
    if (!epic || isCreate) return;
    Object.assign(epic, patch);
    epic = { ...epic };
    Object.assign(pending, patch);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const body = pending;
      pending = {};
      try {
        const res = await fetch(`/api/epics/${epic!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.ok) dispatch('reload');
        // Failed send: fold the fields back in so the next edit retries them.
        // Anything edited since wins, hence `pending` last.
        else pending = { ...body, ...pending };
      } catch {
        pending = { ...body, ...pending };
      }
    }, 300);
  }

  async function commitCreate() {
    if (!draft.name || !draft.name.trim()) return;
    try {
      const body: any = {
        name: draft.name.trim(),
        description: draft.description || undefined,
        goal: draft.goal || undefined,
        status: draft.status,
        color: draft.color,
      };
      if (draft.sprint) body.sprint = draft.sprint;
      const res = await fetch('/api/epics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      dispatch('reload');
      dispatch('close');
    } catch { /* noop */ }
  }

  // ---- Worktree (tas-IK2HcQWo) ----
  // An epic is the unit that maps to a feature branch. Ticket worktrees created
  // after this one branch off it, so it's the natural integration point.
  let worktreeBusy = false;

  async function createEpicWorktree() {
    if (!epic || worktreeBusy) return;
    worktreeBusy = true;
    try {
      const res = await fetch(`/api/epics/${epic.id}/worktree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        if (j.epic) epic = j.epic;
        showToast('Epic worktree created', 'success');
        dispatch('reload');
      } else {
        showToast(j.error || 'Failed to create epic worktree', 'error', 4000);
      }
    } catch {
      showToast('Failed to create epic worktree', 'error');
    } finally {
      worktreeBusy = false;
    }
  }

  async function removeEpicWorktree(force = false) {
    if (!epic || worktreeBusy) return;
    if (!force && !confirm('Remove the epic worktree? The epic branch is deleted too, unless it holds unmerged commits.')) return;
    worktreeBusy = true;
    try {
      const res = await fetch(`/api/epics/${epic.id}/worktree${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        if (j.epic) epic = j.epic;
        showToast(
          j.branchKept ? `Worktree removed — branch ${j.branchKept} kept (unmerged)` : 'Epic worktree removed',
          'success',
          j.branchKept ? 5000 : 2500,
        );
        dispatch('reload');
      } else {
        const msg = j.error || 'Failed to remove epic worktree';
        if (!force && /uncommitted|locked|dirty/i.test(msg)) {
          if (confirm(`${msg}\n\nForce remove?`)) {
            worktreeBusy = false;
            return removeEpicWorktree(true);
          }
        }
        showToast(msg, 'error', 4000);
      }
    } catch {
      showToast('Failed to remove epic worktree', 'error');
    } finally {
      worktreeBusy = false;
    }
  }

  async function copyCd() {
    if (!epic?.worktree) return;
    const ok = await copyToClipboard(`cd "${epic.worktree.path}"`);
    showToast(ok ? 'Copied cd command' : 'Copy failed', ok ? 'success' : 'error');
  }

  // ---- Plan with Claude (tas-HnASryio) ----
  // Mirrors SprintPanel's plan action. Gated on a goal only — unlike a sprint
  // there's no "planning" status requirement, because an active epic picking up
  // more scope is normal.
  $: canPlan = !!epic && !isCreate && !!epic.goal && epic.goal.trim().length > 0;

  function runPlan() {
    if (!epic || !canPlan) return;
    runPrompt(epicBreakdownPrompt(epic, scoped, users), {
      cwd: epic.worktree?.path,
      label: 'Plan ' + epic.name,
    });
  }

  // ---- Review the whole epic's code ----
  // Reviewing ticket by ticket can't see between tickets — duplicated helpers,
  // one ticket invalidating another's assumption, a convention half-applied. An
  // epic maps to a feature branch, so it's the smallest unit where the whole
  // change is visible at once.
  //
  // Needs something to review: the epic branch, or at least one ticket branch.
  // With neither there is no diff, only a pile of uncommitted work in the main
  // checkout, which is not this button's job.
  $: reviewableBranches = (epic?.worktree ? 1 : 0) + scoped.filter(t => !!t.worktree).length;
  $: canReview = !!epic && !isCreate && reviewableBranches > 0;

  // The epic branch forked from its workspace's sprint branch when that sprint
  // has a worktree, else the repo default — the same order the server uses for
  // insights and the PR base. Passed to the prompt so the reviewer diffs against
  // what the branch actually came from.
  $: reviewBase = (() => {
    // Copy to a local first: `epic` is a reassignable prop, so the null guard
    // doesn't narrow inside the `find` callback.
    const sprintId = epic?.sprint;
    if (!sprintId) return null;
    const s = sprints.find(sp => sp.id === sprintId);
    return s?.worktree?.branch || null;
  })();

  function runReview() {
    if (!epic || !canReview) return;
    runPrompt(epicReviewPrompt(epic, scoped, users, reviewBase), {
      cwd: epic.worktree?.path,
      label: 'Review ' + epic.name,
    });
  }

  async function deleteEpic() {
    if (!epic) return;
    // Deleting never touches the worktree — same rule as sprint completion
    // (bug-MtPFb7dg). But the epic record is the only thing that remembers the
    // path, so warn before it goes: afterwards it's a manual `git worktree
    // remove`.
    const wtWarning = epic.worktree
      ? `\n\nIts worktree at ${epic.worktree.path} (branch ${epic.worktree.branch}) is left in place, and tkxr will no longer track it. Remove the worktree first if you want tkxr to clean it up.`
      : '';
    if (!confirm(`Delete this epic? Its tickets stay but lose the epic tag.${wtWarning}`)) return;
    try {
      const res = await fetch(`/api/epics/${epic.id}`, { method: 'DELETE' });
      if (res.ok) {
        dispatch('reload');
        dispatch('close');
      }
    } catch { /* noop */ }
  }
</script>

<header class="head">
  {#if isCreate || !epic}
    <span class="mono id">NEW EPIC</span>
  {:else}
    <span class="id"><CopyId value={epic.id} label="Epic ID" grow /></span>
  {/if}
  <button class="close" on:click={() => dispatch('close')} title="Close"><X size={16} /></button>
</header>

<div class="body">
  <input
    class="ttl"
    placeholder="Epic name"
    bind:value={draft.name}
    on:input={() => !isCreate && schedulePatch({ name: draft.name })}
  />

  <div class="meta">
    <span class="label">Status</span>
    <select
      class="input"
      value={draft.status}
      on:change={(e) => setStatus(e.currentTarget.value)}
    >
      <option value="planning">Planning</option>
      <option value="active">Active</option>
      <option value="completed">Completed</option>
    </select>

    <span class="label">Sprint</span>
    <div class="sprint-field">
      <select
        class="input"
        value={draft.sprint || ''}
        disabled={sprintMoveBusy}
        on:change={(e) => setSprint(e.currentTarget.value)}
      >
        <option value="">Unsorted (no sprint)</option>
        {#each sprints as s (s.id)}
          <option value={s.id}>{s.name}</option>
        {/each}
      </select>
      {#if !isCreate && scoped.length > 0}
        <label class="with-tickets">
          <input type="checkbox" bind:checked={moveTicketsWithEpic} />
          <span>Move its {scoped.length} ticket{scoped.length === 1 ? '' : 's'} too</span>
        </label>
      {/if}
    </div>

    <span class="label">Color</span>
    <div class="colors">
      {#each EPIC_COLORS as c}
        <button
          class="swatch"
          class:sel={draft.color === c}
          style="background:{c}"
          title={c}
          on:click={() => { draft.color = c; if (!isCreate) schedulePatch({ color: c }); }}
        ></button>
      {/each}
    </div>

    <span class="label">Goal</span>
    <input
      class="input"
      placeholder="One-line goal"
      value={draft.goal || ''}
      on:input={(e) => { draft.goal = e.currentTarget.value; if (!isCreate) schedulePatch({ goal: draft.goal }); }}
    />
  </div>

  <div>
    <div class="label" style="margin-bottom:6px">Description</div>
    <textarea
      class="desc"
      placeholder="Describe the epic…"
      bind:value={draft.description}
      on:input={() => !isCreate && schedulePatch({ description: draft.description })}
    ></textarea>
  </div>

  {#if !isCreate && epic}
    <div class="stats">
      <div class="stat"><span class="mono big">{scoped.length}</span><span class="k">tickets</span></div>
      <div class="stat"><span class="mono big">{donePts}/{totalPts}</span><span class="k">points done</span></div>
    </div>
    <div class="ticket-list">
      {#each scoped as t (t.id)}
        <button class="t-row" on:click={() => dispatch('openTicket', t.id)}>
          <span class="mono t-id">{t.id}</span>
          <span class="t-title">{t.title}</span>
          <span class="t-status">{t.status}</span>
        </button>
      {/each}
      {#if scoped.length === 0}
        <div class="empty">No tickets in this epic yet.</div>
      {/if}
    </div>

    <div class="wt-card">
      <div class="wt-head">
        <span class="wt-label">Epic worktree</span>
        {#if epic.worktree}
          <span class="wt-badge">active</span>
        {/if}
      </div>
      {#if epic.worktree}
        <div class="wt-rows">
          <div class="wt-row"><span class="wt-k">Path</span><span class="wt-v mono">{epic.worktree.path}</span></div>
          <div class="wt-row"><span class="wt-k">Branch</span><span class="wt-v mono">{epic.worktree.branch}</span></div>
        </div>
        <div class="wt-actions">
          <button class="btn" on:click={copyCd} disabled={worktreeBusy}>Copy cd</button>
          <button class="btn btn-danger" on:click={() => removeEpicWorktree(false)} disabled={worktreeBusy}>Remove worktree</button>
        </div>
      {:else}
        <div class="wt-hint">A dedicated feature branch + checkout for this epic. Ticket worktrees created after this branch off it, and the epic branch is what opens a PR. Default: <code>tkxr/epic/{epic.id}</code>.</div>
        <button class="btn btn-primary" on:click={createEpicWorktree} disabled={worktreeBusy}>Create epic worktree</button>
      {/if}
    </div>

    {#if epic.worktree}
      <BranchInsights scope="epic" id={epic.id} worktreePath={epic.worktree.path} />
    {/if}

    <div class="orch-card">
      <div class="orch-head">
        <Sparkles size={14} color="var(--ai)" />
        <span>Plan epic with Claude</span>
      </div>
      <div class="orch-hint">
        {#if canPlan}
          Sends a prompt that asks Claude to research the epic goal, then create child tickets (with waves via <code>dependsOn</code>). Guardrails: won't touch existing tickets, won't flip statuses, capped at ~12 new tickets.
        {:else}
          Set a <strong>goal</strong> above to enable planning.
        {/if}
      </div>
      <button class="orch-btn" on:click={runPlan} disabled={!canPlan}>
        <Sparkles size={14} color="#fff" />
        <span>{$claudeAvailable ? 'Plan with Claude' : 'Copy plan prompt'}</span>
      </button>
    </div>

    <div class="orch-card">
      <div class="orch-head">
        <Sparkles size={14} color="var(--ai)" />
        <span>Review epic code with Claude</span>
      </div>
      <div class="orch-hint">
        {#if canReview}
          Reviews {reviewableBranches === 1 ? 'the one branch' : `all ${reviewableBranches} branches`} in this epic together, so cross-ticket problems show up — duplicated work, one ticket breaking another's assumption, a convention half-applied. Findings land as comments. Guardrails: reads only — no edits, no commits, no status changes.
        {:else}
          Nothing to review yet — create a worktree for this epic or one of its tickets first.
        {/if}
      </div>
      <button class="orch-btn" on:click={runReview} disabled={!canReview}>
        <Sparkles size={14} color="#fff" />
        <span>{$claudeAvailable ? 'Review with Claude' : 'Copy review prompt'}</span>
      </button>
    </div>
  {/if}
</div>

<footer class="foot">
  {#if isCreate}
    <button class="btn" on:click={() => dispatch('close')}>Cancel</button>
    <button class="btn btn-primary" on:click={commitCreate}>Create epic</button>
  {:else}
    <button class="btn btn-danger" on:click={deleteEpic}>Delete</button>
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
  .id { font-family: 'IBM Plex Mono'; font-size: 11px; color: var(--faint); flex: 1; }
  .close { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 5px; }
  .close:hover { background: var(--surface-hover); color: var(--text); }
  .body { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 20px; }
  .ttl {
    border: none; background: transparent; color: var(--text);
    font-size: 19px; font-weight: 600; outline: none; padding: 0; font-family: inherit;
  }
  .meta { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 10px 14px; }
  .label {
    font-size: 10.5px; font-weight: 600; letter-spacing: .05em;
    text-transform: uppercase; color: var(--muted);
  }
  .input {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font-size: 12.5px; color: var(--text); outline: none; width: 100%; box-sizing: border-box;
  }
  .input:focus { border-color: var(--accent); }
  .input:disabled { opacity: .6; }
  .sprint-field { display: flex; flex-direction: column; gap: 6px; }
  .with-tickets {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--muted);
    cursor: pointer;
  }
  .colors { display: flex; gap: 6px; flex-wrap: wrap; }
  .swatch {
    width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; padding: 0;
  }
  .swatch.sel { border-color: var(--text); }
  .desc {
    background: var(--surface-hover); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px; font-size: 12.5px; color: var(--text); outline: none; resize: vertical;
    min-height: 80px; width: 100%; box-sizing: border-box; font-family: inherit;
  }
  .desc:focus { border-color: var(--accent); }
  .stats { display: flex; gap: 12px; }
  .stat {
    flex: 1; background: var(--elevated); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px; display: flex; flex-direction: column; gap: 4px;
  }
  .big { font-size: 18px; font-weight: 600; color: var(--text); }
  .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); }
  .ticket-list { display: flex; flex-direction: column; gap: 4px; }
  .t-row {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    cursor: pointer; text-align: left;
  }
  .t-row:hover { background: var(--surface-hover); }
  .t-id { font-size: 10.5px; color: var(--faint); flex: none; }
  .t-title { flex: 1; font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-status { font-size: 10px; text-transform: uppercase; font-weight: 600; color: var(--muted); }
  .empty { font-size: 12px; color: var(--faint); padding: 8px; }
  /* Worktree + Claude cards — same visual language as SprintPanel's. */
  .wt-card, .orch-card {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .wt-head, .orch-head { display: flex; align-items: center; gap: 8px; }
  .orch-head { font-size: 12.5px; font-weight: 600; color: var(--text2); }
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
  .wt-hint, .orch-hint { font-size: 11.5px; color: var(--muted); line-height: 1.4; }
  .wt-hint code, .orch-hint code {
    background: var(--surface);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 10.5px;
  }
  .wt-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .orch-btn {
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
  .orch-btn:hover:not(:disabled) { opacity: .9; }
  .orch-btn:disabled { opacity: .45; cursor: not-allowed; }
  .foot {
    padding: 12px 18px; border-top: 1px solid var(--border-subtle);
    display: flex; align-items: center; gap: 10px; justify-content: space-between;
  }
  .foot-hint { font-size: 10.5px; color: var(--faint); }
  .btn {
    background: var(--surface); border: 1px solid var(--border); border-radius: 7px;
    color: var(--text2); padding: 7px 14px; font-size: 12px; font-weight: 500; cursor: pointer;
  }
  .btn:hover { background: var(--surface-hover); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .btn-danger { color: #ff6b6b; }
</style>
