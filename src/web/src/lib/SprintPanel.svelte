<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { Sprint, Ticket, User } from './stores';
  import { claudeAvailable } from './settings';
  import { avatarColorFor, initials, normalizeTicket, sprintDotColor, STATUS_COLOR } from './util';
  import { copyToClipboard, showToast } from './clipboard';
  import CopyId from './CopyId.svelte';
  import { onTicketEvent } from './ticketEvents';
  import X from './icons/X.svelte';
  import Plus from './icons/Plus.svelte';

  export let sprint: Sprint | null = null;
  export let isCreate = false;
  // No `tickets` prop: the panel fetches its own sprint-scoped slice below,
  // and the last consumer of the caller's paged store was the sprint commit
  // prompt, which is gone (docs/branching-model.md).
  export let users: User[] = [];
  /** All sprints — backs the "move these tickets to…" target picker. */
  export let sprints: Sprint[] = [];

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

  // Dedicated slice of tickets for this sprint + a small unassigned-backlog
  // pool for the "Add from backlog" section. Both are fetched once on mount
  // and refetched on any `ticket_*` WebSocket event while the panel is open
  // (subscription torn down on destroy — no ambient traffic).
  let sprintTickets: Ticket[] = [];
  let unassignedBacklog: Ticket[] = [];
  let sprintTicketsAbort: AbortController | null = null;
  let backlogAbort: AbortController | null = null;

  const SPRINT_LIFECYCLE: Sprint['status'][] = ['planning', 'active', 'completed'];
  $: draftStatus = (draft.status || 'planning') as Sprint['status'];
  $: totalPts = sprintTickets.reduce((s, t) => s + (t.estimate || 0), 0);
  $: donePts = sprintTickets.filter(t => t.status === 'done').reduce((s, t) => s + (t.estimate || 0), 0);
  $: pct = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;

  async function fetchSprintTickets() {
    if (!sprint) return;
    if (sprintTicketsAbort) sprintTicketsAbort.abort();
    const ac = new AbortController();
    sprintTicketsAbort = ac;
    try {
      const res = await fetch(`/api/tickets?sprint=${encodeURIComponent(sprint.id)}&limit=200`, { signal: ac.signal });
      if (!res.ok) return;
      const j = await res.json();
      const items: any[] = Array.isArray(j) ? j : (j.items || []);
      sprintTickets = items.map(normalizeTicket);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      // noop — panel remains usable with stale data
    } finally {
      if (sprintTicketsAbort === ac) sprintTicketsAbort = null;
    }
  }

  async function fetchUnassignedBacklog() {
    // For the "Add from backlog" section we want backlog tickets that don't
    // belong to any sprint. `sprint=none` selects the no-sprint bucket.
    if (backlogAbort) backlogAbort.abort();
    const ac = new AbortController();
    backlogAbort = ac;
    try {
      const res = await fetch('/api/tickets?sprint=none&status=backlog&limit=200', { signal: ac.signal });
      if (!res.ok) return;
      const j = await res.json();
      const items: any[] = Array.isArray(j) ? j : (j.items || []);
      unassignedBacklog = items.map(normalizeTicket);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
    } finally {
      if (backlogAbort === ac) backlogAbort = null;
    }
  }

  async function refetchAll() {
    await Promise.all([fetchSprintTickets(), fetchUnassignedBacklog()]);
  }

  onMount(() => {
    if (!isCreate && sprint) refetchAll();
    // Subscribe to ticket_* events for as long as this panel is mounted; the
    // shared bus closes the socket automatically once we unsubscribe.
    const off = onTicketEvent(() => { if (!isCreate && sprint) refetchAll(); });
    return () => {
      off();
      if (sprintTicketsAbort) sprintTicketsAbort.abort();
      if (backlogAbort) backlogAbort.abort();
    };
  });

  // Coalesce into one pending patch rather than replacing it. Each call used to
  // clear the timer and re-arm it closed over its *own* patch, so two edits
  // inside the 300ms window sent only the second — while `Object.assign` had
  // already applied both locally, so the panel showed the lost one as saved
  // until a reload silently reverted it (bug-7bVl3-Kj).
  let pending: any = {};

  function schedulePatch(patch: any) {
    if (!sprint || isCreate) return;
    Object.assign(sprint, patch);
    sprint = { ...sprint };
    Object.assign(pending, patch);
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      const body = pending;
      pending = {};
      try {
        const res = await fetch(`/api/sprints/${sprint!.id}`, {
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

  // ---- Bulk migrate (tas-vEpBfx0t) ----
  // Rolling unfinished work into the next sprint is the common end-of-sprint
  // move, and doing it a ticket at a time through "Add from backlog" on the
  // other panel doesn't scale past a handful.
  const MIGRATE_STATUSES: Ticket['status'][] = ['backlog', 'progress', 'review', 'blocked', 'done'];
  let migrateTarget = '';
  /** Empty means "every status" — the default whole-sprint move. */
  let migrateStatuses: Ticket['status'][] = [];
  let migrateBusy = false;

  $: otherSprints = sprints.filter(s => s.id !== sprint?.id);
  // Counted off the panel's own slice, which is capped at 200 like every other
  // panel's fetch. The server is authoritative — the toast reports what it
  // actually moved, which is what a >200-ticket sprint should be read from.
  $: migrateSelection = sprintTickets.filter(
    t => migrateStatuses.length === 0 || migrateStatuses.includes(t.status),
  );
  // At the cap the count is a floor, not a total, so the button drops the
  // number rather than promising one it can't stand behind.
  $: migrateCountKnown = sprintTickets.length < 200;

  function toggleMigrateStatus(s: Ticket['status']) {
    migrateStatuses = migrateStatuses.includes(s)
      ? migrateStatuses.filter(x => x !== s)
      : [...migrateStatuses, s];
  }

  async function migrateTickets() {
    if (!sprint || migrateBusy || !migrateTarget) return;
    migrateBusy = true;
    try {
      const res = await fetch('/api/tickets/bulk/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromSprint: sprint.id,
          toSprint: migrateTarget === 'none' ? null : migrateTarget,
          ...(migrateStatuses.length > 0 ? { statuses: migrateStatuses } : {}),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        const targetName = migrateTarget === 'none'
          ? 'Unsorted'
          : (sprints.find(s => s.id === migrateTarget)?.name || 'the target sprint');
        showToast(
          j.moved === 0
            ? `Nothing to move — ${j.matched || 0} matched, all already in ${targetName}`
            : `Moved ${j.moved} ticket${j.moved === 1 ? '' : 's'} to ${targetName}`,
          j.moved === 0 ? 'info' : 'success',
        );
        // An epic belongs to one workspace, so tickets that moved away from an
        // epic staying here were dropped from it. Say so — it's a real edit,
        // not a detail of the move.
        const ungrouped = j.ungroupedTicketIds?.length ?? 0;
        if (ungrouped > 0) {
          showToast(
            `${ungrouped} of them left their epic behind and ${ungrouped === 1 ? 'is' : 'are'} now ungrouped in ${targetName}`,
            'info',
            6000,
          );
        }
        migrateStatuses = [];
        await refetchAll();
        dispatch('reload');
      } else {
        showToast(j.error?.message || 'Failed to move tickets', 'error', 4000);
      }
    } catch {
      showToast('Failed to move tickets', 'error');
    } finally {
      migrateBusy = false;
    }
  }

  // ---- Delete (tas-nptsO5gE) ----
  // Two very different operations behind one button, so it opens a dialog
  // rather than a `confirm()`: the default detaches the sprint's contents into
  // Unsorted, and the cascade permanently deletes them. The dialog fetches the
  // real counts so "delete everything" isn't an abstraction.
  let confirmingDelete = false;
  let deleteMode: 'detach' | 'cascade' = 'detach';
  let cascadeAck = false;
  let deleteBusy = false;
  // Leaving the cascade option re-arms its confirmation, so a tick made and
  // then reconsidered can't carry back into a second look at it.
  $: if (deleteMode === 'detach') cascadeAck = false;
  let contents: {
    tickets: number;
    epics: number;
    comments: number;
    worktrees: { id: string; path: string; branch: string }[];
  } | null = null;

  async function openDeleteDialog() {
    if (!sprint) return;
    confirmingDelete = true;
    deleteMode = 'detach';
    cascadeAck = false;
    contents = null;
    try {
      const res = await fetch(`/api/sprints/${sprint.id}/contents`);
      if (res.ok) contents = await res.json();
    } catch { /* dialog still works, just without the counts */ }
  }

  async function deleteSprint() {
    if (!sprint || deleteBusy) return;
    const cascade = deleteMode === 'cascade';
    if (cascade && !cascadeAck) return;
    deleteBusy = true;
    try {
      const res = await fetch(`/api/sprints/${sprint.id}${cascade ? '?cascade=true' : ''}`, {
        method: 'DELETE',
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        showToast(
          cascade
            ? `Sprint deleted with ${j.deletedTicketIds?.length ?? 0} ticket(s), ${j.deletedEpicIds?.length ?? 0} epic(s), ${j.deletedComments ?? 0} comment(s)`
            : 'Sprint deleted — its tickets and epics moved to Unsorted',
          'success',
          4000,
        );
        confirmingDelete = false;
        dispatch('reload');
        dispatch('close');
      } else {
        showToast(j.error || 'Failed to delete sprint', 'error', 4000);
      }
    } catch {
      showToast('Failed to delete sprint', 'error');
    } finally {
      deleteBusy = false;
    }
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
  {#if isCreate || !sprint?.id}
    <span class="mono id">NEW SPRINT</span>
  {:else}
    <span class="id"><CopyId value={sprint.id} label="Sprint ID" grow /></span>
  {/if}
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

  <!--
    No worktree card, no orchestrate / plan / commit actions. A sprint frames
    concurrent work and owns no branch — those all live on the epic now, where
    there is a goal to plan against and a bounded ticket set to fan out over.
    The one sprint-level agent action is triage, and it lives in TriagePanel.
    See docs/branching-model.md.
  -->
  {#if !isCreate && sprint && sprint.worktree}
    <div class="wt-card">
      <div class="wt-head">
        <span class="wt-label">Legacy sprint worktree</span>
      </div>
      <div class="wt-rows">
        <div class="wt-row"><span class="wt-k">Path</span><span class="wt-v mono">{sprint.worktree.path}</span></div>
        <div class="wt-row"><span class="wt-k">Branch</span><span class="wt-v mono">{sprint.worktree.branch}</span></div>
      </div>
      <div class="wt-hint">
        Sprints no longer own branches. This one predates that change and tkxr no
        longer manages it — remove it by hand with <code>git worktree remove</code>,
        then <code>git branch -d</code> once its work has landed.
      </div>
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

    {#if sprintTickets.length > 0}
      <div class="migrate">
        <div class="section-head">Move tickets to another sprint</div>
        <div class="hint">
          Carries work over in one go — leave the statuses unset to move the whole
          sprint, or pick some to move just those (e.g. everything unfinished).
          Epics stay in this sprint, so tickets that move out of one are ungrouped
          on arrival.
        </div>
        <div class="chips">
          {#each MIGRATE_STATUSES as s (s)}
            {@const on = migrateStatuses.includes(s)}
            <button
              class="chip"
              class:on
              style={on ? `border-color:${STATUS_COLOR[s]};color:${STATUS_COLOR[s]};background:${STATUS_COLOR[s]}1f` : ''}
              on:click={() => toggleMigrateStatus(s)}
            >{s}</button>
          {/each}
          {#if migrateStatuses.length > 0}
            <button class="chip clear" on:click={() => (migrateStatuses = [])}>clear</button>
          {/if}
        </div>
        <div class="migrate-row">
          <select class="input" bind:value={migrateTarget}>
            <option value="">Move to…</option>
            {#each otherSprints as s (s.id)}
              <option value={s.id}>{s.name}{s.status === 'completed' ? ' (completed)' : ''}</option>
            {/each}
            <option value="none">Unsorted (no sprint)</option>
          </select>
          <button
            class="btn btn-primary"
            disabled={!migrateTarget || migrateBusy || migrateSelection.length === 0}
            on:click={migrateTickets}
          >
            {#if migrateBusy}
              Moving…
            {:else if migrateCountKnown}
              Move {migrateSelection.length} ticket{migrateSelection.length === 1 ? '' : 's'}
            {:else}
              Move tickets
            {/if}
          </button>
        </div>
      </div>
    {/if}

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
    <button class="btn btn-danger" on:click={openDeleteDialog}>Delete sprint</button>
    <span class="foot-hint">Edits save automatically</span>
  {/if}
</footer>

<svelte:window on:keydown={(e) => { if (confirmingDelete && e.key === 'Escape') confirmingDelete = false; }} />

{#if confirmingDelete && sprint}
  <div class="modal-layer">
    <!-- Click-away lives on its own empty layer behind the dialog; Escape is
         handled at the window above. -->
    <div class="modal-scrim" role="presentation" on:click={() => (confirmingDelete = false)}></div>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Delete sprint">
      <div class="modal-head">Delete “{sprint.name}”</div>

      <div class="modal-body">
        <div class="counts">
          {#if contents}
            <span><strong>{contents.tickets}</strong> ticket{contents.tickets === 1 ? '' : 's'}</span>
            <span><strong>{contents.epics}</strong> epic{contents.epics === 1 ? '' : 's'}</span>
            <span><strong>{contents.comments}</strong> comment{contents.comments === 1 ? '' : 's'}</span>
          {:else}
            <span class="muted">Counting what's in this sprint…</span>
          {/if}
        </div>

        <label class="opt" class:sel={deleteMode === 'detach'}>
          <input type="radio" bind:group={deleteMode} value="detach" />
          <span>
            <strong>Keep the contents</strong>
            <em>Tickets and epics move to the Unsorted workspace, reachable from the sprint switcher.</em>
          </span>
        </label>

        <label class="opt danger" class:sel={deleteMode === 'cascade'}>
          <input type="radio" bind:group={deleteMode} value="cascade" />
          <span>
            <strong>Delete everything under it</strong>
            <em>
              Permanently deletes this sprint's epics, its tickets and their comments.
              There is no undo and nothing is archived.
            </em>
          </span>
        </label>

        {#if deleteMode === 'cascade'}
          {#if contents && contents.worktrees.length > 0}
            <div class="warn">
              {contents.worktrees.length} worktree{contents.worktrees.length === 1 ? '' : 's'} under this sprint
              stay checked out on disk, and tkxr stops tracking them — remove them
              with <code>git worktree remove</code> afterwards:
              <ul>
                {#each contents.worktrees as w (w.id)}
                  <li class="mono">{w.path} <span class="muted">({w.branch})</span></li>
                {/each}
              </ul>
            </div>
          {/if}
          <label class="ack">
            <input type="checkbox" bind:checked={cascadeAck} />
            <span>
              I understand
              {contents ? `${contents.tickets} ticket${contents.tickets === 1 ? '' : 's'} and ${contents.epics} epic${contents.epics === 1 ? '' : 's'}` : 'these tickets and epics'}
              will be permanently deleted.
            </span>
          </label>
        {/if}
      </div>

      <div class="modal-foot">
        <button class="btn" on:click={() => (confirmingDelete = false)}>Cancel</button>
        <button
          class="btn btn-danger"
          disabled={deleteBusy || (deleteMode === 'cascade' && !cascadeAck)}
          on:click={deleteSprint}
        >
          {deleteBusy
            ? 'Deleting…'
            : deleteMode === 'cascade' ? 'Delete sprint + contents' : 'Delete sprint only'}
        </button>
      </div>
    </div>
  </div>
{/if}

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

  /* --- Bulk migrate --- */
  .migrate {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px;
  }
  .hint { font-size: 11.5px; color: var(--muted); line-height: 1.45; margin-bottom: 10px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .chip {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--muted);
    padding: 3px 10px;
    font-size: 11px;
    font-family: inherit;
    text-transform: capitalize;
    cursor: pointer;
  }
  .chip:hover { color: var(--text); border-color: var(--border-strong); }
  .chip.on { font-weight: 600; }
  .chip.clear { text-transform: none; color: var(--faint); }
  .migrate-row { display: flex; gap: 8px; align-items: center; }
  .migrate-row .input { flex: 1; }

  /* --- Delete dialog --- */
  .modal-layer {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    z-index: 60;
  }
  .modal-scrim {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, .55);
  }
  .modal {
    position: relative;
    width: 100%;
    max-width: 460px;
    background: var(--card);
    border: 1px solid var(--border-2);
    border-radius: 12px;
    display: flex;
    flex-direction: column;
    max-height: 80vh;
  }
  .modal-head {
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
    font-size: 14px;
    font-weight: 600;
    color: var(--text);
  }
  .modal-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
  }
  .counts { display: flex; gap: 14px; font-size: 12px; color: var(--text2); }
  .counts strong { color: var(--text); font-family: 'IBM Plex Mono'; }
  .muted { color: var(--faint); }
  .opt {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
  }
  .opt.sel { border-color: var(--accent); }
  .opt.danger.sel { border-color: #e5687f; }
  .opt strong { display: block; font-size: 12.5px; color: var(--text); font-weight: 600; }
  .opt em {
    display: block;
    font-style: normal;
    font-size: 11.5px;
    color: var(--muted);
    line-height: 1.45;
    margin-top: 3px;
  }
  .warn {
    background: #f2b5441a;
    border: 1px solid #f2b54455;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 11.5px;
    color: var(--text2);
    line-height: 1.45;
  }
  .warn ul { margin: 6px 0 0; padding-left: 16px; }
  .warn li { margin-top: 2px; }
  .warn code {
    background: var(--surface);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 10.5px;
  }
  .ack {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    font-size: 11.5px;
    color: var(--text2);
    line-height: 1.45;
    cursor: pointer;
  }
  .modal-foot {
    padding: 12px 18px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
</style>
