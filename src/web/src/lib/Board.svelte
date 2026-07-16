<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Sprint, Ticket, User } from './stores';
  import { STATUS_COLOR, STATUS_LABEL, STATUS_ORDER, statusTint } from './util';
  import { draggingTicketId } from './drag';
  import BoardCard from './BoardCard.svelte';
  import Plus from './icons/Plus.svelte';

  export let tickets: Ticket[] = [];
  export let sprints: Sprint[] = [];
  export let users: User[] = [];
  export let commentCounts: Record<string, number> = {};

  const dispatch = createEventDispatcher();

  $: sprintById = new Map(sprints.map(s => [s.id, s]));
  $: userById = new Map(users.map((u, i) => [u.id, { user: u, index: i }]));
  $: byStatus = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = tickets.filter(t => t.status === s);
    return acc;
  }, {} as Record<string, Ticket[]>);

  let dragOverCol: string | null = null;
  let quickAddCol: string | null = null;
  let quickAddValue = '';

  function onColDragOver(status: string) {
    return (e: DragEvent) => { e.preventDefault(); dragOverCol = status; };
  }
  function onColDragLeave() { dragOverCol = null; }
  function onColDrop(status: string) {
    return async (e: DragEvent) => {
      e.preventDefault();
      dragOverCol = null;
      const tid = $draggingTicketId;
      draggingTicketId.set(null);
      if (!tid) return;
      const t = tickets.find(x => x.id === tid);
      if (!t || t.status === status) return;
      try {
        const res = await fetch(`/api/tickets/${tid}/status`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (res.ok) dispatch('reload');
      } catch { /* noop */ }
    };
  }

  function startQuickAdd(status: string) {
    quickAddCol = status;
    quickAddValue = '';
    setTimeout(() => document.getElementById(`quick-${status}`)?.focus(), 0);
  }
  async function commitQuickAdd(status: string) {
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
        dispatch('reload');
      }
    } catch { /* noop */ }
    quickAddCol = null;
    quickAddValue = '';
  }
  function handleQuickKey(status: string, e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commitQuickAdd(status); }
    else if (e.key === 'Escape') { e.preventDefault(); quickAddCol = null; quickAddValue = ''; }
  }
</script>

<div class="board">
  {#each STATUS_ORDER as status}
    {@const color = STATUS_COLOR[status]}
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
        <span class="mono count">{byStatus[status].length}</span>
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
        {#each byStatus[status] as t (t.id)}
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
        {#if byStatus[status].length === 0 && quickAddCol !== status}
          <button class="empty" on:click={() => startQuickAdd(status)}>+ Add ticket</button>
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
</style>
