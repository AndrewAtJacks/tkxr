<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { Sprint, User, Ticket } from './stores';
  import { avatarColorFor, initials, sprintDotColor } from './util';
  import { theme } from './theme';
  import { currentUserId, resolveCurrentUser } from './currentUser';
  import { draggingTicketId } from './drag';
  import { onTicketEvent } from './ticketEvents';
  import Search from './icons/Search.svelte';
  import Sparkles from './icons/Sparkles.svelte';
  import Columns from './icons/Columns.svelte';
  import List from './icons/List.svelte';
  import Plus from './icons/Plus.svelte';
  import Filter from './icons/Filter.svelte';
  import Sun from './icons/Sun.svelte';
  import Moon from './icons/Moon.svelte';

  export let version = '';
  export let view: 'board' | 'list' = 'board';
  export let activeSprint: string = 'all';
  export let activeUser: string = 'all';
  export let sprints: Sprint[] = [];
  export let users: User[] = [];
  export let tickets: Ticket[] = [];
  // Legacy prop from `+page.svelte`. Kept for backwards compat but no longer
  // authoritative — Sidebar now reads `/api/tickets/summary` on mount and on
  // ticket_* WS events (tas-z-8q_Ljc). Parent may pass this in during the
  // brief window before summary loads; after that our fetched value wins.
  export let triageCount = 0;
  export let panel: string | null = null;

  const dispatch = createEventDispatcher();

  let dragOverKey: string | null = null;
  let showCompleted = false;
  let pickerOpen = false;
  let footerEl: HTMLDivElement | null = null;

  // Server-computed aggregates. Populated on mount and refreshed on any
  // ticket_* WS event (see tas-z-8q_Ljc / tas-4MNJ9qP5). Falls back to the
  // legacy `triageCount` prop + `tickets.length` until the first fetch lands.
  interface TicketSummary {
    counts: { total: number; backlog: number; progress: number; review: number; blocked: number; done: number };
    triage: { unassignedOpen: number; criticalOpen: number; backlogCount: number };
    byStatus: { backlog: number; progress: number; review: number; blocked: number; done: number };
  }
  let summary: TicketSummary | null = null;
  let summaryAbort: AbortController | null = null;

  // Burst coalescing for `/api/tickets/summary` refetches (tas-98YN7GqK).
  // Every `ticket_*` WS event nudges this timer; the actual fetch fires 500ms
  // after the last nudge in the burst. Rapid mutation storms (bulk imports,
  // reordering, board drags landing back-to-back) hit the summary endpoint
  // once instead of once-per-event.
  const SUMMARY_COALESCE_MS = 500;
  let summaryTimer: number | null = null;
  function scheduleSummaryRefetch() {
    if (summaryTimer !== null) window.clearTimeout(summaryTimer);
    summaryTimer = window.setTimeout(() => {
      summaryTimer = null;
      fetchSummary();
    }, SUMMARY_COALESCE_MS);
  }

  async function fetchSummary() {
    if (summaryAbort) summaryAbort.abort();
    const ac = new AbortController();
    summaryAbort = ac;
    try {
      const res = await fetch('/api/tickets/summary', { signal: ac.signal });
      if (!res.ok) return;
      summary = await res.json();
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
    } finally {
      if (summaryAbort === ac) summaryAbort = null;
    }
  }

  // Recompute triage count the same way `+page.svelte` did (unassigned open,
  // any critical open, backlog >= 4 each contribute 1). Reading straight from
  // summary keeps this correct even when only a slice of tickets is loaded
  // client-side.
  $: computedTriage = summary
    ? (
        (summary.triage.unassignedOpen > 0 ? 1 : 0)
        + (summary.triage.criticalOpen > 0 ? 1 : 0)
        + (summary.triage.backlogCount >= 4 ? 1 : 0)
      )
    : triageCount;

  $: me = resolveCurrentUser(users, $currentUserId);
  $: meIndex = me ? users.findIndex(u => u.id === me!.id) : -1;

  function togglePicker() { pickerOpen = !pickerOpen; }
  function selectMe(id: string | null) {
    currentUserId.set(id);
    pickerOpen = false;
  }

  function onWindowClick(e: MouseEvent) {
    if (!pickerOpen) return;
    if (footerEl && !footerEl.contains(e.target as Node)) pickerOpen = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && pickerOpen) pickerOpen = false;
  }
  let offTicketEvents: (() => void) | null = null;
  onMount(() => {
    window.addEventListener('mousedown', onWindowClick);
    window.addEventListener('keydown', onKey);
    fetchSummary();
    // Sidebar is effectively always mounted, so this subscription is stable
    // for the lifetime of the app shell. That's fine — the shared bus is
    // idempotent and holds a single WebSocket regardless of subscriber count.
    // Bursts of ticket_* events coalesce into one summary fetch (see
    // `scheduleSummaryRefetch`) so board drags / bulk imports don't hammer
    // `/api/tickets/summary`.
    offTicketEvents = onTicketEvent(() => scheduleSummaryRefetch());
  });
  onDestroy(() => {
    window.removeEventListener('mousedown', onWindowClick);
    window.removeEventListener('keydown', onKey);
    if (offTicketEvents) offTicketEvents();
    if (summaryTimer !== null) window.clearTimeout(summaryTimer);
    if (summaryAbort) summaryAbort.abort();
  });

  // Prefer server total when available so the "All tickets" badge is correct
  // even after the main ticket store transitions to paged loading.
  $: totalCount = summary ? summary.counts.total : tickets.length;
  $: sprintCounts = new Map(sprints.map(s => [s.id, tickets.filter(t => t.sprint === s.id).length]));
  $: userCounts = new Map(users.map(u => [u.id, tickets.filter(t => t.assignee === u.id).length]));
  $: activeSprints = sprints.filter(s => s.status !== 'completed');
  $: completedSprints = sprints.filter(s => s.status === 'completed');
  $: visibleSprints = showCompleted ? [...activeSprints, ...completedSprints] : activeSprints;

  function selectView(v: 'board' | 'list') { dispatch('view', v); }
  function selectAllSprints() { dispatch('sprint', 'all'); }
  function openSprintPanel(id: string) { dispatch('manageSprint', id); }
  function toggleSprintFilter(id: string) {
    dispatch('sprint', activeSprint === id ? 'all' : id);
  }
  function selectAllUsers() { dispatch('user', 'all'); }
  function openUserPanel(id: string) { dispatch('manageUser', id); }
  function toggleUserFilter(id: string) {
    dispatch('user', activeUser === id ? 'all' : id);
  }
  function openPalette() { dispatch('palette'); }
  function openTriage() { dispatch('triage'); }
  function newSprint() { dispatch('newSprint'); }
  function newUser() { dispatch('newUser'); }

  async function persistTicket(id: string, patch: any) {
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) dispatch('reload');
    } catch (e) { /* noop */ }
  }

  function onDrop(kind: 'all-sprint' | 'sprint' | 'all-user' | 'user', id?: string) {
    return async (e: DragEvent) => {
      e.preventDefault();
      dragOverKey = null;
      const tid = $draggingTicketId;
      draggingTicketId.set(null);
      if (!tid) return;
      if (kind === 'all-sprint') await persistTicket(tid, { sprint: null });
      else if (kind === 'sprint') await persistTicket(tid, { sprint: id });
      else if (kind === 'all-user') await persistTicket(tid, { assignee: null });
      else if (kind === 'user') await persistTicket(tid, { assignee: id });
    };
  }
  function onDragOver(key: string) {
    return (e: DragEvent) => { e.preventDefault(); dragOverKey = key; };
  }
  function onDragLeave() { dragOverKey = null; }

  function rowStyle(active: boolean, dragKey: string): string {
    const dragging = dragOverKey === dragKey;
    const bg = dragging
      ? 'rgba(76,141,255,.13)'
      : active ? 'var(--nav-active)' : 'transparent';
    const shadow = dragging ? 'box-shadow: inset 0 0 0 1px #4c8dff;' : '';
    const color = active ? 'var(--text)' : 'var(--muted)';
    const weight = active ? 600 : 400;
    return `display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:${bg};color:${color};font-weight:${weight};font-size:12.5px;cursor:pointer;${shadow}`;
  }
  function navStyle(active: boolean): string {
    return `display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:7px;background:${active ? 'var(--nav-active)' : 'transparent'};color:${active ? 'var(--text)' : 'var(--muted)'};font-weight:${active ? 600 : 500};font-size:12.5px;border:none;cursor:pointer;text-align:left;width:100%;`;
  }
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="logo">t</div>
    <span class="name">tkxr</span>
    {#if version}<span class="ver">{version}</span>{/if}
  </div>

  <button class="search-btn" on:click={openPalette}>
    <Search size={14} />
    <span>Search or ask…</span>
    <span class="kbd">⌘K</span>
  </button>

  <nav class="nav">
    <button style={navStyle(view === 'board' && !panel)} on:click={() => selectView('board')}>
      <Columns size={15} />
      <span>Board</span>
    </button>
    <button style={navStyle(view === 'list' && !panel)} on:click={() => selectView('list')}>
      <List size={15} />
      <span>List</span>
    </button>
    <button style={navStyle(panel === 'triage')} on:click={openTriage}>
      <Sparkles size={15} />
      <span>AI Triage</span>
      {#if computedTriage > 0}
        <span class="triage-pill">{computedTriage}</span>
      {/if}
    </button>
  </nav>

  <div class="section-label">
    <span>Sprints</span>
    <button class="icon-btn" title="New sprint" on:click={newSprint}><Plus size={12} /></button>
  </div>
  <div class="section-list" style="max-height:200px">
    <button
      style={rowStyle(activeSprint === 'all' && !panel, 'all-sprint')}
      on:click={selectAllSprints}
      on:dragover={onDragOver('all-sprint')}
      on:dragleave={onDragLeave}
      on:drop={onDrop('all-sprint')}
    >
      <span class="dot" style="background:var(--faint)"></span>
      <span class="row-label">All tickets</span>
      <span class="mono count">{totalCount}</span>
    </button>
    {#each visibleSprints as sp (sp.id)}
      <div
        class="row"
        role="button"
        tabindex="-1"
        style={dragOverKey === `sp:${sp.id}` ? 'background:rgba(76,141,255,.13);box-shadow:inset 0 0 0 1px #4c8dff;' : ''}
        on:dragover={onDragOver(`sp:${sp.id}`)}
        on:dragleave={onDragLeave}
        on:drop={onDrop('sprint', sp.id)}
      >
        <button
          class="row-main"
          style="color:{activeSprint === sp.id ? 'var(--text)' : 'var(--muted)'};font-weight:{activeSprint === sp.id ? 600 : 400};background:{activeSprint === sp.id ? 'var(--nav-active)' : 'transparent'}"
          title="Open sprint"
          on:click={() => openSprintPanel(sp.id)}
        >
          <span class="dot" style="background:{sprintDotColor(sp.status)}"></span>
          <span class="row-label">{sp.name}</span>
        </button>
        <span class="mono count">{sprintCounts.get(sp.id) || 0}</span>
        <button
          class="filter-btn"
          class:active={activeSprint === sp.id}
          title={activeSprint === sp.id ? 'Clear sprint filter' : 'Filter board to this sprint'}
          on:click={() => toggleSprintFilter(sp.id)}
        >
          <Filter size={11} />
        </button>
      </div>
    {/each}
    {#if completedSprints.length > 0}
      <button
        class="show-completed"
        title={showCompleted ? 'Hide completed sprints' : 'Show completed sprints'}
        on:click={() => (showCompleted = !showCompleted)}
      >
        {showCompleted ? 'Hide completed' : `Show completed (${completedSprints.length})`}
      </button>
    {/if}
  </div>

  <div class="section-label">
    <span>People</span>
    <button class="icon-btn" title="Add person" on:click={newUser}><Plus size={12} /></button>
  </div>
  <div class="section-list" style="flex:1;padding-bottom:8px">
    <button
      style={rowStyle(activeUser === 'all' && !panel, 'all-user')}
      on:click={selectAllUsers}
      on:dragover={onDragOver('all-user')}
      on:dragleave={onDragLeave}
      on:drop={onDrop('all-user')}
    >
      <span class="avatar" style="background:var(--chip);color:var(--muted);font-weight:600">∗</span>
      <span class="row-label">Everyone</span>
    </button>
    {#each users as u, i (u.id)}
      <div
        class="row"
        role="button"
        tabindex="-1"
        style={dragOverKey === `u:${u.id}` ? 'background:rgba(76,141,255,.13);box-shadow:inset 0 0 0 1px #4c8dff;' : ''}
        on:dragover={onDragOver(`u:${u.id}`)}
        on:dragleave={onDragLeave}
        on:drop={onDrop('user', u.id)}
      >
        <button
          class="row-main"
          style="color:{activeUser === u.id ? 'var(--text)' : 'var(--muted)'};font-weight:{activeUser === u.id ? 600 : 400};background:{activeUser === u.id ? 'var(--nav-active)' : 'transparent'}"
          title="Open person"
          on:click={() => openUserPanel(u.id)}
        >
          <span class="avatar" style="background:{avatarColorFor(u, i)};color:#0b0e12">{initials(u.displayName)}</span>
          <span class="row-label">{u.displayName}</span>
        </button>
        <span class="mono count">{userCounts.get(u.id) || 0}</span>
        <button
          class="filter-btn"
          class:active={activeUser === u.id}
          title={activeUser === u.id ? 'Clear person filter' : 'Filter board to this person'}
          on:click={() => toggleUserFilter(u.id)}
        >
          <Filter size={11} />
        </button>
      </div>
    {/each}
  </div>

  <div class="footer" bind:this={footerEl}>
    <button class="me-btn" on:click={togglePicker} title="Change current user" aria-haspopup="listbox" aria-expanded={pickerOpen}>
      {#if me}
        <span class="avatar footer-avatar" style="background:{avatarColorFor(me, meIndex)};color:#0b0e12">{initials(me.displayName)}</span>
        <div class="footer-meta">
          <div class="footer-name">{me.displayName}</div>
          <div class="footer-handle">@{me.username}</div>
        </div>
      {:else}
        <span class="avatar footer-avatar" style="background:var(--chip);color:var(--muted)">?</span>
        <div class="footer-meta">
          <div class="footer-name">Pick user</div>
          <div class="footer-handle">not set</div>
        </div>
      {/if}
      <span class="chevron" aria-hidden="true">▾</span>
    </button>
    <span class="live-dot" title="Live"></span>
    <button class="theme-btn" title="Toggle theme" on:click={() => theme.toggle()}>
      {#if $theme === 'dark'}<Sun size={14} />{:else}<Moon size={14} />{/if}
    </button>

    {#if pickerOpen}
      <div class="picker" role="listbox">
        <div class="picker-head">Current user</div>
        {#each users as u, i (u.id)}
          <button
            class="picker-row"
            class:selected={me?.id === u.id}
            role="option"
            aria-selected={me?.id === u.id}
            on:click={() => selectMe(u.id)}
          >
            <span class="avatar picker-avatar" style="background:{avatarColorFor(u, i)};color:#0b0e12">{initials(u.displayName)}</span>
            <span class="picker-meta">
              <span class="picker-name">{u.displayName}</span>
              <span class="picker-handle">@{u.username}</span>
            </span>
            {#if me?.id === u.id}
              <span class="picker-check" aria-hidden="true">✓</span>
            {/if}
          </button>
        {/each}
        {#if users.length === 0}
          <div class="picker-empty">No users yet. Add one from the People section.</div>
        {/if}
        {#if me}
          <button class="picker-clear" on:click={() => selectMe(null)}>Clear current user</button>
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  .sidebar {
    width: 238px;
    background: var(--sidebar);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    height: 100%;
  }
  .brand {
    padding: 16px 16px 12px;
    display: flex;
    align-items: center;
    gap: 9px;
  }
  .logo {
    width: 26px; height: 26px;
    border-radius: 7px;
    background: linear-gradient(135deg, #4c8dff, #6b5bff);
    display: flex; align-items: center; justify-content: center;
    font-family: 'IBM Plex Mono';
    font-weight: 600;
    font-size: 13px;
    color: #fff;
  }
  .name { font-weight: 600; font-size: 15px; letter-spacing: -.01em; }
  .ver {
    font-family: 'IBM Plex Mono';
    font-size: 10px;
    color: var(--faint);
    background: var(--card);
    padding: 2px 6px;
    border-radius: 5px;
  }
  .search-btn {
    margin: 2px 12px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    color: var(--muted);
    font-size: 12.5px;
    transition: background .12s, border-color .12s, color .12s;
  }
  .search-btn:hover {
    background: var(--surface-hover);
    border-color: var(--border-hover);
    color: var(--text2);
  }
  .search-btn > span:first-of-type { flex: 1; text-align: left; }
  .kbd {
    font-family: 'IBM Plex Mono';
    font-size: 10px;
    background: var(--border-subtle);
    padding: 2px 5px;
    border-radius: 4px;
    color: var(--faint);
  }
  .nav {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px;
  }
  .triage-pill {
    margin-left: auto;
    font-size: 9px;
    font-family: 'IBM Plex Mono';
    color: #6b5bff;
    background: rgba(107,91,255,.12);
    padding: 2px 5px;
    border-radius: 4px;
  }
  .section-label {
    padding: 18px 16px 6px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .icon-btn {
    width: 18px; height: 18px;
    display: flex; align-items: center; justify-content: center;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--faint);
    cursor: pointer;
  }
  .icon-btn:hover { background: var(--surface); color: var(--text); }
  .section-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0 8px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    border-radius: 6px;
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    background: transparent;
  }
  .row-main:hover { background: var(--surface); color: var(--text); }
  .row-label {
    flex: 1;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dot {
    width: 7px; height: 7px;
    border-radius: 2px;
    flex: none;
  }
  .avatar {
    width: 20px; height: 20px;
    border-radius: 6px;
    display: flex; align-items: center; justify-content: center;
    font-size: 9.5px;
    font-weight: 600;
    color: #0b0e12;
    flex: none;
  }
  .count {
    font-family: 'IBM Plex Mono';
    font-size: 10px;
    color: var(--faint);
    padding: 0 6px;
  }
  .filter-btn {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--faint);
    cursor: pointer;
    margin-right: 2px;
    opacity: 0;
    transition: opacity .12s, background .12s, color .12s;
  }
  .row:hover .filter-btn { opacity: 1; }
  .filter-btn:hover { background: var(--chip); color: var(--text); }
  .filter-btn.active {
    opacity: 1;
    color: var(--accent);
    background: rgba(76,141,255,.12);
  }
  .show-completed {
    margin: 4px 4px 2px;
    padding: 5px 8px;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--faint);
    font-size: 11px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background .12s, color .12s;
  }
  .show-completed:hover { background: var(--surface); color: var(--text2); }
  .footer {
    border-top: 1px solid var(--border-subtle);
    padding: 10px 14px;
    display: flex;
    align-items: center;
    gap: 8px;
    position: relative;
  }
  .me-btn {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    margin: -4px -6px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .me-btn:hover { background: var(--surface); }
  .footer-avatar { width: 22px; height: 22px; }
  .footer-meta { flex: 1; min-width: 0; }
  .footer-name {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .footer-handle {
    font-size: 10px;
    color: var(--faint);
    font-family: 'IBM Plex Mono';
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chevron {
    font-size: 9px;
    color: var(--faint);
    margin-left: 2px;
  }
  .picker {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 8px;
    right: 8px;
    background: var(--elevated, var(--surface));
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,.35);
    padding: 4px;
    z-index: 20;
    max-height: 260px;
    overflow-y: auto;
  }
  .picker-head {
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .picker-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 6px;
    color: var(--text2);
    cursor: pointer;
    text-align: left;
    font-size: 12.5px;
  }
  .picker-row:hover { background: var(--surface-hover); color: var(--text); }
  .picker-row.selected { background: var(--nav-active); color: var(--text); }
  .picker-avatar { width: 22px; height: 22px; }
  .picker-meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .picker-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-handle {
    font-size: 10px;
    color: var(--faint);
    font-family: 'IBM Plex Mono';
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .picker-check { color: var(--accent, #4c8dff); font-size: 12px; }
  .picker-empty {
    padding: 8px 10px;
    font-size: 11.5px;
    color: var(--faint);
  }
  .picker-clear {
    display: block;
    width: 100%;
    margin-top: 4px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-top: 1px solid var(--border-subtle);
    color: var(--muted);
    font-size: 11.5px;
    cursor: pointer;
    text-align: left;
    border-radius: 0 0 6px 6px;
  }
  .picker-clear:hover { background: var(--surface-hover); color: var(--text); }
  .live-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #46c17f;
    box-shadow: 0 0 6px rgba(70,193,127,.6);
  }
  .theme-btn {
    width: 24px; height: 24px;
    display: flex; align-items: center; justify-content: center;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: var(--muted);
    cursor: pointer;
  }
  .theme-btn:hover { background: var(--surface); color: var(--text); }
</style>
