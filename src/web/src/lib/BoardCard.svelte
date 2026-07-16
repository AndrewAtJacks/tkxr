<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Sprint, Ticket, User } from './stores';
  import { avatarColorFor, initials, PRIORITY_META } from './util';
  import { draggingTicketId } from './drag';
  import Bug from './icons/Bug.svelte';
  import CheckSquare from './icons/CheckSquare.svelte';
  import MessageSquare from './icons/MessageSquare.svelte';

  export let ticket: Ticket;
  export let sprint: Sprint | undefined = undefined;
  export let assignee: User | undefined = undefined;
  export let assigneeIndex = 0;
  export let commentCount = 0;

  const dispatch = createEventDispatcher();

  let dragging = false;

  function onDragStart(e: DragEvent) {
    dragging = true;
    draggingTicketId.set(ticket.id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ticket.id);
    }
  }
  function onDragEnd() {
    dragging = false;
    draggingTicketId.set(null);
  }

  $: prio = ticket.priority ? PRIORITY_META[ticket.priority] : null;
</script>

<div
  class="card"
  class:dragging
  role="button"
  tabindex="0"
  draggable="true"
  on:click={() => dispatch('open')}
  on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && dispatch('open')}
  on:dragstart={onDragStart}
  on:dragend={onDragEnd}
>
  <div class="row1">
    {#if ticket.type === 'bug'}
      <Bug size={12} color="var(--type-bug)" />
    {:else}
      <CheckSquare size={12} color="var(--type-task)" />
    {/if}
    <span class="mono id">{ticket.id}</span>
    {#if prio}
      <span class="prio" style="background:{prio.bg};color:{prio.color}">{prio.label}</span>
    {/if}
  </div>
  <div class="title">{ticket.title}</div>
  <div class="row3">
    {#if sprint}
      <span class="sprint-chip">{sprint.name}</span>
    {/if}
    {#if ticket.estimate}
      <span class="mono pts">{ticket.estimate}pt</span>
    {/if}
    <span class="spacer"></span>
    {#if commentCount > 0}
      <span class="comments"><MessageSquare size={11} /><span>{commentCount}</span></span>
    {/if}
    {#if assignee}
      <span class="avatar" style="background:{avatarColorFor(assignee, assigneeIndex)}">{initials(assignee.displayName)}</span>
    {/if}
  </div>
</div>

<style>
  .card {
    background: var(--card);
    border: 1px solid var(--border-2);
    border-radius: 10px;
    padding: 11px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    cursor: pointer;
    transition: border-color .12s, background .12s, opacity .12s;
    text-align: left;
  }
  .card:hover {
    border-color: var(--border-strong);
    background: var(--card-hover);
  }
  .card.dragging {
    border-color: var(--accent);
    opacity: .5;
  }
  .row1 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .id {
    font-size: 10.5px;
    color: var(--faint);
    flex: 1;
  }
  .prio {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 5px;
  }
  .title {
    font-size: 13px;
    font-weight: 500;
    line-height: 1.35;
    color: var(--text);
  }
  .row3 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }
  .sprint-chip {
    font-size: 10px;
    padding: 2px 6px;
    background: var(--surface);
    border: 1px solid var(--border-2);
    border-radius: 5px;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
  }
  .pts {
    font-size: 10.5px;
    color: var(--faint);
  }
  .spacer { flex: 1; }
  .comments {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    color: var(--faint);
    font-family: 'IBM Plex Mono';
  }
  .avatar {
    width: 20px; height: 20px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9.5px;
    font-weight: 600;
    color: #0b0e12;
  }
</style>
