<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Sprint, Ticket, User } from './stores';
  import { claudeConfig } from './stores';
  import { avatarColorFor, initials, sprintDotColor, STATUS_COLOR } from './util';
  import { copyToClipboard, showToast } from './clipboard';
  import { orchestrateSprintPrompt, sprintBreakdownPrompt } from './prompts';
  import { runPrompt } from './claudeRun';
  import X from './icons/X.svelte';
  import Plus from './icons/Plus.svelte';
  import Sparkles from './icons/Sparkles.svelte';

  export let sprint: Sprint | null = null;
  export let isCreate = false;
  export let tickets: Ticket[] = [];
  export let users: User[] = [];

  const dispatch = createEventDispatcher();

  let draft: Partial<Sprint> = sprint && !isCreate
    ? { ...sprint }
    : {
        name: '',
        goal: '',
        status: 'planning',
        startDate: undefined,
        endDate: undefined,
      };
  let saveTimer: number | null = null;

  const SPRINT_LIFECYCLE: Sprint['status'][] = ['planning', 'active', 'completed'];
  $: draftStatus = (draft.status || 'planning') as Sprint['status'];
  $: sprintTickets = sprint ? tickets.filter(t => t.sprint === sprint!.id) : [];
  $: totalPts = sprintTickets.reduce((s, t) => s + (t.estimate || 0), 0);
  $: donePts = sprintTickets.filter(t => t.status === 'done').reduce((s, t) => s + (t.estimate || 0), 0);
  $: pct = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;
  $: unassignedBacklog = tickets.filter(t => t.status === 'backlog' && !t.sprint);

  function schedulePatch(patch: any) {
    if (!sprint || isCreate) return;
    Object.assign(sprint, patch);
    sprint = { ...sprint };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/sprints/${sprint!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) dispatch('reload');
      } catch { /* noop */ }
    }, 300);
  }

  async function commitCreate() {
    if (!draft.name || !draft.name.trim()) return;
    try {
      const res = await fetch('/api/sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) return;
      dispatch('reload');
      dispatch('close');
    } catch { /* noop */ }
  }

  async function deleteSprint() {
    if (!sprint) return;
    if (!confirm('Delete this sprint?')) return;
    try {
      const res = await fetch(`/api/sprints/${sprint.id}`, { method: 'DELETE' });
      if (res.ok) {
        dispatch('reload');
        dispatch('close');
      }
    } catch { /* noop */ }
  }

  let worktreeBusy = false;

  async function createSprintWorktree() {
    if (!sprint || worktreeBusy) return;
    worktreeBusy = true;
    try {
      const res = await fetch(`/api/sprints/${sprint.id}/worktree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.sprint) {
          sprint = j.sprint;
          draft.worktree = j.sprint.worktree;
        }
        showToast('Sprint worktree created', 'success');
        dispatch('reload');
      } else {
        const j = await res.json().catch(() => ({}));
        showToast(j.error || 'Failed to create sprint worktree', 'error', 4000);
      }
    } catch {
      showToast('Failed to create sprint worktree', 'error');
    } finally {
      worktreeBusy = false;
    }
  }

  async function removeSprintWorktree(force = false) {
    if (!sprint || worktreeBusy) return;
    if (!confirm('Remove the sprint worktree? The sprint branch will be deleted too (uncommitted work will be lost if you skip force + the tree is dirty).')) return;
    worktreeBusy = true;
    try {
      const res = await fetch(`/api/sprints/${sprint.id}/worktree${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        const j = await res.json();
        if (j.sprint) {
          sprint = j.sprint;
          draft.worktree = null;
        }
        showToast('Sprint worktree removed', 'success');
        dispatch('reload');
      } else {
        const j = await res.json().catch(() => ({}));
        const msg = j.error || 'Failed to remove sprint worktree';
        if (!force && /uncommitted|locked|dirty/i.test(msg)) {
          if (confirm(`${msg}\n\nForce remove?`)) {
            worktreeBusy = false;
            return removeSprintWorktree(true);
          }
        }
        showToast(msg, 'error', 4000);
      }
    } catch {
      showToast('Failed to remove sprint worktree', 'error');
    } finally {
      worktreeBusy = false;
    }
  }

  async function copyCd() {
    if (!sprint?.worktree) return;
    const ok = await copyToClipboard(`cd "${sprint.worktree.path}"`);
    showToast(ok ? 'Copied cd command' : 'Copy failed', ok ? 'success' : 'error');
  }

  function runOrchestrate() {
    if (!sprint) return;
    runPrompt(orchestrateSprintPrompt(sprint, tickets, users), {
      cwd: sprint.worktree?.path,
      label: 'Orchestrate ' + sprint.name,
    });
  }

  $: canPlan = !!sprint && !!sprint.goal && sprint.goal.trim().length > 0 && sprint.status === 'planning';

  function runPlan() {
    if (!sprint || !canPlan) return;
    runPrompt(sprintBreakdownPrompt(sprint, tickets, users), {
      cwd: sprint.worktree?.path,
      label: 'Plan ' + sprint.name,
    });
  }

  async function assignToSprint(t: Ticket) {
    if (!sprint) return;
    try {
      const res = await fetch(`/api/tickets/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprint: sprint.id }),
      });
      if (res.ok) dispatch('reload');
    } catch { /* noop */ }
  }

  function userMeta(id?: string | null) {
    if (!id) return null;
    const idx = users.findIndex(u => u.id === id);
    return idx >= 0 ? { user: users[idx], index: idx } : null;
  }

  function dateInput(d?: any): string {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return '';
    return dt.toISOString().slice(0, 10);
  }
</script>

<header class="head">
  <span class="dot" style="background:{sprintDotColor(draftStatus)}"></span>
  <span class="mono id">{isCreate ? 'NEW SPRINT' : sprint?.id}</span>
  {#if !isCreate}
    <span class="status-pill" style="color:{sprintDotColor(draftStatus)};background:{sprintDotColor(draftStatus)}22">{draftStatus}</span>
  {/if}
  <button class="close" on:click={() => dispatch('close')}><X size={16} /></button>
</header>

<div class="body">
  <input
    class="ttl"
    placeholder="Sprint name"
    bind:value={draft.name}
    on:input={() => !isCreate && schedulePatch({ name: draft.name })}
  />

  <div>
    <div class="label">Lifecycle</div>
    <div class="segmented">
      {#each SPRINT_LIFECYCLE as s (s)}
        {@const c = sprintDotColor(s)}
        <button
          class:active={draft.status === s}
          style={draft.status === s ? `border-color:${c};color:${c};background:${c}22` : ''}
          on:click={() => { draft.status = s; if (!isCreate) schedulePatch({ status: s }); }}
        >{s}</button>
      {/each}
    </div>
  </div>

  <div class="dates">
    <div>
      <div class="label">Start</div>
      <input
        class="input"
        type="date"
        value={dateInput(draft.startDate)}
        on:change={(e) => {
          const v = e.currentTarget.value || undefined;
          draft.startDate = v;
          if (!isCreate) schedulePatch({ startDate: v });
        }}
      />
    </div>
    <div>
      <div class="label">End</div>
      <input
        class="input"
        type="date"
        value={dateInput(draft.endDate)}
        on:change={(e) => {
          const v = e.currentTarget.value || undefined;
          draft.endDate = v;
          if (!isCreate) schedulePatch({ endDate: v });
        }}
      />
    </div>
  </div>

  <div>
    <div class="label">Goal</div>
    <textarea
      class="desc"
      placeholder="What are we trying to achieve?"
      bind:value={draft.goal}
      on:input={() => !isCreate && schedulePatch({ goal: draft.goal })}
    ></textarea>
  </div>

  {#if !isCreate && sprint}
    <div class="wt-card">
      <div class="wt-head">
        <span class="wt-label">Sprint worktree</span>
        {#if sprint.worktree}
          <span class="wt-badge">active</span>
        {/if}
      </div>
      {#if sprint.worktree}
        <div class="wt-rows">
          <div class="wt-row"><span class="wt-k">Path</span><span class="wt-v mono">{sprint.worktree.path}</span></div>
          <div class="wt-row"><span class="wt-k">Branch</span><span class="wt-v mono">{sprint.worktree.branch}</span></div>
        </div>
        <div class="wt-actions">
          <button class="btn" on:click={copyCd} disabled={worktreeBusy}>Copy cd</button>
          <button class="btn btn-danger" on:click={() => removeSprintWorktree(false)} disabled={worktreeBusy}>Remove worktree</button>
        </div>
      {:else}
        <div class="wt-hint">A dedicated feature branch + checkout for this sprint. New ticket worktrees created after this will branch off the sprint branch. Default: <code>tkxr/sprint/{sprint.id}</code>.</div>
        <button class="btn btn-primary" on:click={createSprintWorktree} disabled={worktreeBusy}>Create sprint worktree</button>
      {/if}
    </div>

    <div class="orch-card">
      <div class="orch-head">
        <Sparkles size={14} color="var(--ai)" />
        <span>Plan sprint with Claude</span>
      </div>
      <div class="orch-hint">
        {#if canPlan}
          Sends a prompt that asks Claude to research the sprint goal, then create child tickets (with waves via <code>dependsOn</code>). Guardrails: won't touch existing tickets, won't flip statuses, capped at ~12 new tickets.
        {:else if !sprint.goal || !sprint.goal.trim()}
          Set a sprint <strong>goal</strong> above to enable planning.
        {:else if sprint.status !== 'planning'}
          Only available while the sprint is in <strong>planning</strong>.
        {/if}
      </div>
      <button class="orch-btn" on:click={runPlan} disabled={!canPlan}>
        <Sparkles size={14} color="#fff" />
        <span>{$claudeConfig?.available ? 'Plan with Claude' : 'Copy plan prompt'}</span>
      </button>
    </div>

    <div class="orch-card">
      <div class="orch-head">
        <Sparkles size={14} color="var(--ai)" />
        <span>Orchestrate this sprint</span>
      </div>
      <div class="orch-hint">Copies a prompt that puts Claude Code in orchestrator mode — it fans out one sub-agent per open ticket, then merges each ticket branch into the sprint branch as they finish. {#if !sprint.worktree}Consider creating the sprint worktree first.{/if}</div>
      <button class="orch-btn" on:click={runOrchestrate}>
        <Sparkles size={14} color="#fff" />
        <span>{$claudeConfig?.available ? 'Run in Claude' : 'Copy prompt'}</span>
      </button>
    </div>
  {/if}

  {#if !isCreate && sprint && totalPts > 0}
    <div class="burn">
      <div class="burn-head">
        <span class="label">Sprint burn</span>
        <span class="mono">{donePts}/{totalPts} pts · {pct}%</span>
      </div>
      <div class="track"><div class="fill" style="width:{pct}%;background:{pct > 75 ? '#46c17f' : pct > 25 ? '#f2b544' : '#4c8dff'}"></div></div>
    </div>
  {/if}

  {#if !isCreate && sprint}
    <div>
      <div class="section-head">Tickets · {sprintTickets.length}</div>
      {#if sprintTickets.length === 0}
        <div class="empty">No tickets in this sprint yet.</div>
      {:else}
        <div class="items">
          {#each sprintTickets as t}
            {@const asg = userMeta(t.assignee)}
            <button class="item" on:click={() => dispatch('openTicket', t.id)}>
              <span class="s-dot" style="background:{STATUS_COLOR[t.status]}"></span>
              <span class="mono id">{t.id}</span>
              <span class="item-title">{t.title}</span>
              {#if asg}
                <span class="avatar" style="background:{avatarColorFor(asg.user, asg.index)}">{initials(asg.user.displayName)}</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if unassignedBacklog.length > 0}
      <div>
        <div class="section-head">Add from backlog</div>
        <div class="items">
          {#each unassignedBacklog as t}
            <div class="item add">
              <span class="s-dot" style="background:{STATUS_COLOR[t.status]}"></span>
              <span class="mono id">{t.id}</span>
              <span class="item-title">{t.title}</span>
              <button class="add-btn" on:click={() => assignToSprint(t)} title="Add to sprint"><Plus size={12} /></button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<footer class="foot">
  {#if isCreate}
    <button class="btn" on:click={() => dispatch('close')}>Cancel</button>
    <button class="btn btn-primary" on:click={commitCreate}>Create sprint</button>
  {:else}
    <button class="btn btn-danger" on:click={deleteSprint}>Delete sprint</button>
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
  .dot { width: 8px; height: 8px; border-radius: 3px; }
  .id { font-family: 'IBM Plex Mono'; font-size: 11px; color: var(--faint); flex: 1; }
  .status-pill {
    font-size: 10.5px; font-weight: 600;
    padding: 2px 7px;
    border-radius: 5px;
    text-transform: capitalize;
  }
  .close { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 5px; }
  .close:hover { background: var(--surface-hover); color: var(--text); }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .ttl {
    border: none;
    background: transparent;
    color: var(--text);
    font-size: 19px;
    font-weight: 600;
    outline: none;
    padding: 0;
    font-family: inherit;
  }
  .label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 6px;
    display: block;
  }
  .segmented {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .segmented > button {
    flex: 1;
    padding: 6px 10px;
    background: transparent;
    color: var(--muted);
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    text-transform: capitalize;
  }
  .segmented > button.active { font-weight: 600; }
  .dates { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .desc {
    background: var(--surface-hover);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px;
    font-size: 12.5px;
    color: var(--text);
    outline: none;
    resize: vertical;
    min-height: 60px;
    width: 100%;
    font-family: inherit;
  }
  .desc:focus { border-color: var(--accent); }
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
  .wt-hint, .orch-hint { font-size: 11.5px; color: var(--muted); line-height: 1.4; }
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
  .orch-head { font-size: 12.5px; font-weight: 600; color: var(--text2); }
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
  .orch-hint code {
    background: var(--surface);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 10.5px;
  }

  .burn {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .burn-head { display: flex; justify-content: space-between; margin-bottom: 6px; }
  .mono { font-family: 'IBM Plex Mono'; font-size: 11px; color: var(--muted); }
  .track { height: 6px; background: var(--surface-3); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; border-radius: 3px; transition: width .5s ease; }
  .section-head {
    font-size: 12px;
    font-weight: 600;
    color: var(--text2);
    margin-bottom: 8px;
  }
  .empty { color: var(--faint); font-size: 12px; padding: 8px 0; }
  .items { display: flex; flex-direction: column; gap: 4px; }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    width: 100%;
  }
  .item:hover { background: var(--surface); }
  .item.add { cursor: default; }
  .item.add:hover { background: transparent; }
  .s-dot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
  .item .id { flex: 0 0 auto; }
  .item-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .avatar {
    width: 22px; height: 22px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9.5px;
    font-weight: 600;
    color: #0b0e12;
  }
  .add-btn {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: var(--muted);
    cursor: pointer;
  }
  .add-btn:hover { background: var(--accent); color: #fff; border-color: var(--accent); }

  .foot {
    padding: 12px 18px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }
  .foot-hint { font-size: 10.5px; color: var(--faint); }
</style>
