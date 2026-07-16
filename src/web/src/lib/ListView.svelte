<script lang="ts">
  import { createEventDispatcher, onDestroy, onMount } from 'svelte';
  import { pagedTickets, type Sprint, type Ticket, type User } from './stores';
  import { avatarColorFor, initials, STATUS_COLOR, STATUS_LABEL } from './util';
  import { draggingTicketId } from './drag';
  import Bug from './icons/Bug.svelte';
  import CheckSquare from './icons/CheckSquare.svelte';

  export let tickets: Ticket[] = [];
  export let sprints: Sprint[] = [];
  export let users: User[] = [];

  const dispatch = createEventDispatcher();

  // Paged-store readables drive the infinite-scroll sentinel + empty state.
  // `tickets` is still the render source (parent already subscribes to the
  // paged items and passes them in) so we don't double-subscribe there, but
  // we need direct access to `loading` / `nextCursor` / `total` for the
  // "loading first page" vs "no results" distinction and the fetch guard.
  const pagedLoading = pagedTickets.loading;
  const pagedNextCursor = pagedTickets.nextCursor;
  const pagedTotal = pagedTickets.total;

  $: sprintById = new Map(sprints.map(s => [s.id, s]));
  $: userById = new Map(users.map((u, i) => [u.id, { user: u, index: i }]));

  let draggingId: string | null = null;

  function onDragStart(id: string) {
    return (e: DragEvent) => {
      draggingId = id;
      draggingTicketId.set(id);
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
      }
    };
  }
  function onDragEnd() {
    draggingId = null;
    draggingTicketId.set(null);
  }

  // ---------------------------------------------------------------------------
  // Infinite scroll sentinel
  // ---------------------------------------------------------------------------
  // Observe a sentinel div at the tail of the scroll container. When it comes
  // within ~1 viewport of visibility we call `pagedTickets.fetchNextPage()`.
  // The store guards against parallel/last-page fetches internally, but we
  // also gate on `!$pagedLoading && $pagedNextCursor` here so rapid scroll
  // events don't queue up N pending calls (which would still be safe, just
  // wasteful).
  let listEl: HTMLDivElement;
  let sentinelEl: HTMLDivElement;
  let observer: IntersectionObserver | null = null;

  function maybeFetch() {
    if (!$pagedLoading && $pagedNextCursor) {
      void pagedTickets.fetchNextPage();
    }
  }

  onMount(() => {
    if (typeof IntersectionObserver === 'undefined' || !sentinelEl) return;
    observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            maybeFetch();
            break;
          }
        }
      },
      { root: listEl, rootMargin: '400px 0px' },
    );
    observer.observe(sentinelEl);
  });

  onDestroy(() => {
    observer?.disconnect();
    observer = null;
  });
</script>

<div class="list" bind:this={listEl}>
  <div class="row head">
    <span></span>
    <span>ID</span>
    <span>Title</span>
    <span>Status</span>
    <span>Sprint</span>
    <span>Pts</span>
    <span>Owner</span>
  </div>
  {#each tickets as t (t.id)}
    {@const sprint = t.sprint ? sprintById.get(t.sprint) : undefined}
    {@const asg = t.assignee ? userById.get(t.assignee) : undefined}
    <button
      class="row"
      class:dragging={draggingId === t.id}
      draggable="true"
      on:dragstart={onDragStart(t.id)}
      on:dragend={onDragEnd}
      on:click={() => dispatch('open', t.id)}
    >
      <span class="icon">
        {#if t.type === 'bug'}<Bug size={12} color="var(--type-bug)" />
        {:else}<CheckSquare size={12} color="var(--type-task)" />{/if}
      </span>
      <span class="mono id">{t.id}</span>
      <span class="title">{t.title}</span>
      <span class="status" style="color:{STATUS_COLOR[t.status]}">{STATUS_LABEL[t.status]}</span>
      <span class="sprint">{sprint?.name || '—'}</span>
      <span class="mono pts">{t.estimate ?? '—'}</span>
      <span class="owner">
        {#if asg}
          <span class="avatar" style="background:{avatarColorFor(asg.user, asg.index)}">{initials(asg.user.displayName)}</span>
        {:else}
          <span class="avatar" style="background:var(--chip);color:var(--muted);font-weight:600">·</span>
        {/if}
      </span>
    </button>
  {/each}
  <!--
    Sentinel: sits after the last row inside the scroll container so the
    IntersectionObserver (root = .list, rootMargin 400px) fires as we
    approach the tail. Kept in the DOM even at end-of-list so the observer
    reference stays valid; the maybeFetch() guard turns it into a no-op.
  -->
  <div class="sentinel" bind:this={sentinelEl} aria-hidden="true"></div>
  {#if tickets.length === 0}
    {#if $pagedLoading && $pagedTotal === 0}
      <div class="empty">Loading…</div>
    {:else if $pagedTotal === 0}
      <div class="empty">No tickets match.</div>
    {/if}
  {:else if $pagedLoading}
    <div class="loading-more">Loading more…</div>
  {/if}
</div>

<style>
  .list {
    padding: 8px 18px 24px;
    overflow-y: auto;
    height: 100%;
  }
  .row {
    display: grid;
    grid-template-columns: 26px 96px 1fr 92px 130px 60px 68px;
    align-items: center;
    gap: 10px;
    padding: 8px 4px;
    border: none;
    background: transparent;
    border-bottom: 1px solid var(--border-faint);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 12.5px;
  }
  .row:hover { background: var(--surface); }
  .row.dragging { opacity: .5; cursor: grabbing; }
  .row[draggable="true"] { cursor: grab; }
  .head {
    position: sticky;
    top: 0;
    background: var(--bg);
    color: var(--faint);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .05em;
    text-transform: uppercase;
    cursor: default;
  }
  .head:hover { background: var(--bg); }
  .icon { display: flex; align-items: center; justify-content: center; }
  .mono { font-family: 'IBM Plex Mono'; }
  .id { color: var(--faint); font-size: 10.5px; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .status { font-weight: 600; font-size: 11.5px; }
  .sprint { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pts { color: var(--faint); }
  .owner { display: flex; align-items: center; justify-content: center; }
  .avatar {
    width: 22px; height: 22px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9.5px;
    font-weight: 600;
    color: #0b0e12;
  }
  .empty {
    padding: 40px;
    text-align: center;
    color: var(--faint);
  }
  .sentinel {
    /* 1px keeps it observable while contributing no visible height. */
    height: 1px;
    width: 100%;
  }
  .loading-more {
    padding: 12px;
    text-align: center;
    color: var(--faint);
    font-size: 11.5px;
  }
</style>
