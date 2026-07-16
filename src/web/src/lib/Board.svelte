<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { derived } from 'svelte/store';
  import type { PagedTicketQuery, PagedTicketStore, Sprint, Ticket, TicketStatus, User } from './stores';
  import { createPagedTicketStore } from './stores';
  import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, statusTint } from './util';
  import { draggingTicketId } from './drag';
  import { onTicketEvent } from './ticketEvents';
  import BoardCard from './BoardCard.svelte';
  import Plus from './icons/Plus.svelte';

  // Board owns one paged store per column (tas-MKYRoS6x). A single global
  // paged fetch can't fill the Kanban evenly — page 1 might be all `progress`
  // and leave `backlog` empty. Each column keeps its own `nextCursor` so
  // "Load more" only extends that column.
  export let sprints: Sprint[] = [];
  export let users: User[] = [];
  export let commentCounts: Record<string, number> = {};
  /**
   * Filter/sort state from the toolbar/sidebar. `status` is injected per-column,
   * `limit` is fixed at 25 per column here. When this changes we reset all five
   * column stores in lockstep.
   */
  export let query: Omit<PagedTicketQuery, 'status' | 'limit'> = {};

  const PAGE_SIZE = 25;

  const dispatch = createEventDispatcher();

  $: sprintById = new Map(sprints.map(s => [s.id, s]));
  $: userById = new Map(users.map((u, i) => [u.id, { user: u, index: i }]));

  // One store per column. Instantiated once at mount so subscriptions from
  // the template stay stable across query changes.
  const stores: Record<TicketStatus, PagedTicketStore> = {
    backlog: createPagedTicketStore(),
    progress: createPagedTicketStore(),
    review: createPagedTicketStore(),
    blocked: createPagedTicketStore(),
    done: createPagedTicketStore(),
  };

  // Combine each column's readable fields into single top-level derived stores
  // so the template can `$colItems` / `$colTotals` / etc. via record lookup.
  // Svelte auto-subscription only works on top-level identifiers, not on
  // `stores[status].items`.
  const colItems = derived(
    [stores.backlog.items, stores.progress.items, stores.review.items, stores.blocked.items, stores.done.items],
    ([b, p, r, bl, d]) => ({ backlog: b, progress: p, review: r, blocked: bl, done: d } as Record<TicketStatus, Ticket[]>),
  );
  const colTotals = derived(
    [stores.backlog.total, stores.progress.total, stores.review.total, stores.blocked.total, stores.done.total],
    ([b, p, r, bl, d]) => ({ backlog: b, progress: p, review: r, blocked: bl, done: d } as Record<TicketStatus, number>),
  );
  const colCursors = derived(
    [stores.backlog.nextCursor, stores.progress.nextCursor, stores.review.nextCursor, stores.blocked.nextCursor, stores.done.nextCursor],
    ([b, p, r, bl, d]) => ({ backlog: b, progress: p, review: r, blocked: bl, done: d } as Record<TicketStatus, string | null>),
  );
  const colLoadings = derived(
    [stores.backlog.loading, stores.progress.loading, stores.review.loading, stores.blocked.loading, stores.done.loading],
    ([b, p, r, bl, d]) => ({ backlog: b, progress: p, review: r, blocked: bl, done: d } as Record<TicketStatus, boolean>),
  );

  // Track applied query so the reactive reset doesn't refire on same-value
  // reassignments (e.g. parent reruns without change).
  let lastQueryKey = '';

  function queryKey(q: Omit<PagedTicketQuery, 'status' | 'limit'>): string {
    return JSON.stringify({
      q: q.q || '',
      sprint: q.sprint || '',
      assignee: q.assignee || '',
      type: q.type || '',
      sortBy: q.sortBy || '',
    });
  }

  function resetAllColumns() {
    for (const status of STATUS_ORDER) {
      stores[status].resetAndFetch({ ...query, status, limit: PAGE_SIZE });
    }
  }

  // Any filter/sort change refetches page 1 for all five columns.
  $: {
    const key = queryKey(query);
    if (key !== lastQueryKey) {
      lastQueryKey = key;
      resetAllColumns();
    }
  }

  // Refetch a single column's page 1 (e.g. after a drag-drop or quick-add
  // moves a card into/out of it).
  function refreshColumn(status: TicketStatus) {
    stores[status].resetAndFetch({ ...query, status, limit: PAGE_SIZE });
  }

  // WS wiring: pipe ticket_* events into every column's store so cards move
  // between columns (or new tickets appear) without a full board reload.
  // `applyEvent` on the paged store already handles the created/updated/deleted
  // cases correctly against each column's `status` filter.
  let offTicketEvents: (() => void) | null = null;
  onMount(() => {
    offTicketEvents = onTicketEvent((evt) => {
      if (evt.type === 'ticket_created' || evt.type === 'ticket_updated' || evt.type === 'ticket_deleted') {
        for (const status of STATUS_ORDER) {
          stores[status].applyEvent(evt as any);
        }
      }
    });
  });
  onDestroy(() => {
    if (offTicketEvents) offTicketEvents();
  });

  let dragOverCol: TicketStatus | null = null;
  let quickAddCol: TicketStatus | null = null;
  let quickAddValue = '';

  function onColDragOver(status: TicketStatus) {
    return (e: DragEvent) => { e.preventDefault(); dragOverCol = status; };
  }
  function onColDragLeave() { dragOverCol = null; }
  function onColDrop(status: TicketStatus) {
    return async (e: DragEvent) => {
      e.preventDefault();
      dragOverCol = null;
      const tid = $draggingTicketId;
      draggingTicketId.set(null);
      if (!tid) return;
      // Find source column + ticket by walking each column's current items.
      let sourceStatus: TicketStatus | null = null;
      for (const s of STATUS_ORDER) {
        if (stores[s].snapshot().some(t => t.id === tid)) { sourceStatus = s; break; }
      }
      if (!sourceStatus || sourceStatus === status) return;
      try {
        const res = await fetch(`/api/tickets/${tid}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (res.ok) {
          // Refetch both affected columns' first page. WS `ticket_updated` will
          // also fire and `applyEvent` will remove/insert, but an explicit
          // refetch also restores the correct `total` for the destination
          // column (WS applyEvent intentionally doesn't bump total on inserts
          // that would double-count).
          refreshColumn(sourceStatus);
          refreshColumn(status);
        }
      } catch { /* noop */ }
    };
  }

  function startQuickAdd(status: TicketStatus) {
    quickAddCol = status;
    quickAddValue = '';
    setTimeout(() => document.getElementById(`quick-${status}`)?.focus(), 0);
  }
  async function commitQuickAdd(status: TicketStatus) {
    const title = quickAddValue.trim();
    if (!title) { quickAddCol = null; return; }
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'task', title, status }),
      });
      if (res.ok) {
        const created = await res.json();
        // Post-create: update status to selected column (since createTicket defaults to backlog)
        if (status !== 'backlog') {
          await fetch(`/api/tickets/${created.id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
          });
        }
        // Refresh the destination column so the new card appears at the top
        // even before the WS event arrives. Also refetch backlog when the
        // server-side default transitioned through it.
        refreshColumn(status);
        if (status !== 'backlog') refreshColumn('backlog');
        // Let parent refresh sidebar/comment counts etc.
        dispatch('reload');
      }
    } catch { /* noop */ }
    quickAddCol = null;
    quickAddValue = '';
  }
  function handleQuickKey(status: TicketStatus, e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitQuickAdd(status); }
    else if (e.key === 'Escape') { e.preventDefault(); quickAddCol = null; quickAddValue = ''; }
  }

  function loadMore(status: TicketStatus) {
    stores[status].fetchNextPage();
  }
</script>

<div class="board">
  {#each STATUS_ORDER as status}
    {@const color = STATUS_COLOR[status]}
    {@const list = $colItems[status]}
    {@const total = $colTotals[status]}
    {@const cursor = $colCursors[status]}
    {@const loading = $colLoadings[status]}
    <div
      class="col"
      style="background:{statusTint(status)};border-color:{dragOverCol === status ? 'var(--accent)' : 'var(--border-faint)'}"
      on:dragover={onColDragOver(status)}
      on:dragleave={onColDragLeave}
      on:drop={onColDrop(status)}
      role="region"
      aria-label={STATUS_LABEL[status]}
    >
      <div class="col-head">
        <span class="dot" style="background:{color}"></span>
        <span class="col-title" style="color:{color}">{STATUS_LABEL[status]}</span>
        <span class="mono count">{total}</span>
        <span class="spacer"></span>
        <button class="add-btn" title="Add ticket" on:click={() => startQuickAdd(status)}>
          <Plus size={12} />
        </button>
      </div>

      {#if quickAddCol === status}
        <input
          id={`quick-${status}`}
          class="quick"
          bind:value={quickAddValue}
          placeholder="Ticket title, Enter to save"
          on:keydown={(e) => handleQuickKey(status, e)}
          on:blur={() => commitQuickAdd(status)}
        />
      {/if}

      <div class="cards">
        {#each list as t (t.id)}
          {@const sprint = t.sprint ? sprintById.get(t.sprint) : undefined}
          {@const asg = t.assignee ? userById.get(t.assignee) : undefined}
          <BoardCard
            ticket={t}
            {sprint}
            assignee={asg?.user}
            assigneeIndex={asg?.index ?? 0}
            commentCount={commentCounts[t.id] || 0}
            on:open={() => dispatch('open', t.id)}
          />
        {/each}
        {#if list.length === 0 && quickAddCol !== status && !loading}
          <button class="empty" on:click={() => startQuickAdd(status)}>+ Add ticket</button>
        {/if}
        {#if cursor !== null}
          <button
            class="load-more"
            disabled={loading}
            on:click={() => loadMore(status)}
          >
            {loading ? 'Loading…' : `Load more (${total - list.length} left)`}
          </button>
        {/if}
      </div>
    </div>
  {/each}
</div>

<style>
  .board {
    display: flex;
    gap: 14px;
    padding: 16px 18px;
    overflow-x: auto;
    height: 100%;
    align-items: stretch;
  }
  .col {
    flex: 1;
    min-width: 262px;
    border: 1px solid var(--border-faint);
    border-radius: 12px;
    padding: 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color .12s;
  }
  .col-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot { width: 8px; height: 8px; border-radius: 3px; }
  .col-title {
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: .01em;
  }
  .count {
    font-family: 'IBM Plex Mono';
    font-size: 10.5px;
    padding: 1px 6px;
    background: var(--surface);
    border-radius: 5px;
    color: var(--faint);
  }
  .spacer { flex: 1; }
  .add-btn {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--muted);
    cursor: pointer;
  }
  .add-btn:hover { background: var(--surface); color: var(--text); }
  .quick {
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: 8px;
    padding: 7px 10px;
    font-size: 12.5px;
    outline: none;
    color: var(--text);
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
    flex: 1;
  }
  .empty {
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: 8px;
    color: var(--faint);
    padding: 10px;
    font-size: 12px;
    cursor: pointer;
    text-align: center;
  }
  .empty:hover { border-color: var(--border-strong); color: var(--muted); }
  .load-more {
    background: var(--surface);
    border: 1px solid var(--border-faint);
    border-radius: 8px;
    color: var(--muted);
    padding: 8px 10px;
    font-size: 11.5px;
    cursor: pointer;
    text-align: center;
    margin-top: 2px;
  }
  .load-more:hover:not(:disabled) {
    border-color: var(--border-strong);
    color: var(--text);
  }
  .load-more:disabled {
    cursor: default;
    color: var(--faint);
  }
</style>
