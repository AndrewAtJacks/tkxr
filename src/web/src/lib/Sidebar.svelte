<script lang="ts">
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import type { Epic, Sprint, User, Ticket } from './stores';
  import { avatarColorFor, initials, sprintDotColor } from './util';
  import { theme } from './theme';
  import { currentUserId, resolveCurrentUser } from './currentUser';
  import { draggingTicketId } from './drag';
  import { onTicketEvent } from './ticketEvents';
  import { cliDisabled } from './settings';
  import { claudeConfig } from './stores';
  import Search from './icons/Search.svelte';
  import Sparkles from './icons/Sparkles.svelte';
  import Columns from './icons/Columns.svelte';
  import List from './icons/List.svelte';
  import Plus from './icons/Plus.svelte';
  import Edit from './icons/Edit.svelte';
  import Filter from './icons/Filter.svelte';
  import Sun from './icons/Sun.svelte';
  import Moon from './icons/Moon.svelte';
  import SettingsIcon from './icons/Settings.svelte';

  export let version = '';
  export let view: 'board' | 'list' = 'board';
  // Active workspace (sprint) — the frame the whole board sits inside.
  export let workspace: Sprint | null = null;
  /** True when the active workspace is the "Unsorted" pseudo-sprint. */
  export let unsorted = false;
  /**
   * Raw workspace id used to scope `/api/tickets/summary`. A sprint id, the
   * literal `none` (Unsorted), or '' before a workspace is picked.
   */
  export let sprintScope: string = '';
  // In-workspace epic grouping filter. 'all' | 'none' | epic id.
  export let activeEpic: string = 'all';
  export let epics: Epic[] = [];
  export let activeUser: string = 'all';
  export let users: User[] = [];
  export let tickets: Ticket[] = [];
  // True while the sprint switcher (workspace picker) is the active view.
  export let switcherOpen = false;
  // Legacy prop from `+page.svelte`. Kept for backwards compat but no longer
  // authoritative — Sidebar now reads `/api/tickets/summary` on mount and on
  // ticket_* WS events (tas-z-8q_Ljc). Parent may pass this in during the
  // brief window before summary loads; after that our fetched value wins.
  export let triageCount = 0;
  export let panel: string | null = null;

  const dispatch = createEventDispatcher();

  let dragOverKey: string | null = null;
  let pickerOpen = false;
  let settingsOpen = false;
  let footerEl: HTMLDivElement | null = null;
  let settingsEl: HTMLDivElement | null = null;

  // Server-computed aggregates. Populated on mount and refreshed on any
  // ticket_* WS event (see tas-z-8q_Ljc / tas-4MNJ9qP5). Falls back to the
  // legacy `triageCount` prop + `tickets.length` until the first fetch lands.
  interface TicketSummary {
    counts: { total: number; backlog: number; progress: number; review: number; blocked: number; done: number };
    triage: { unassignedOpen: number; criticalOpen: number; backlogCount: number };
    byStatus: { backlog: number; progress: number; review: number; blocked: number; done: number };
    /** Ticket count per epic id within the scoped workspace; `none` = no epic. */
    byEpic?: Record<string, number>;
    /** Ticket count per assignee id within the scoped workspace; `none` = unassigned. */
    byAssignee?: Record<string, number>;
    /** Story points across the scoped workspace. */
    points?: { total: number; done: number };
    /** Story points per epic id within the scoped workspace; `none` = no epic. */
    pointsByEpic?: Record<string, { total: number; done: number }>;
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
      // Scope the aggregate to the active workspace — an unscoped project-wide
      // total would contradict the workspace-scoped board beside it now that a
      // sprint frames the whole view.
      const url = sprintScope
        ? `/api/tickets/summary?sprint=${encodeURIComponent(sprintScope)}`
        : '/api/tickets/summary';
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) return;
      summary = await res.json();
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
    } finally {
      if (summaryAbort === ac) summaryAbort = null;
    }
  }

  // Refetch whenever the workspace changes so the badges follow the board.
  // Gated on `summaryMounted` so this doesn't race the onMount fetch.
  let summaryMounted = false;
  $: if (summaryMounted) {
    void sprintScope;
    fetchSummary();
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
    const target = e.target as Node;
    if (pickerOpen && footerEl && !footerEl.contains(target)) pickerOpen = false;
    if (settingsOpen && settingsEl && !settingsEl.contains(target)) settingsOpen = false;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    if (pickerOpen) pickerOpen = false;
    if (settingsOpen) settingsOpen = false;
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
    summaryMounted = true;
  });
  onDestroy(() => {
    window.removeEventListener('mousedown', onWindowClick);
    window.removeEventListener('keydown', onKey);
    if (offTicketEvents) offTicketEvents();
    if (summaryTimer !== null) window.clearTimeout(summaryTimer);
    if (summaryAbort) summaryAbort.abort();
  });

  // Prefer server totals when available so the badges stay correct once the
  // main ticket store transitions to paged loading. `summary` is scoped to the
  // active workspace, so these agree with the board. The `tickets`-derived
  // fallbacks only cover the window before the first summary lands (they read
  // the current page, so they under-count).
  $: totalCount = summary ? summary.counts.total : tickets.length;
  $: epicCounts = new Map(
    epics.map(e => [
      e.id,
      summary?.byEpic ? (summary.byEpic[e.id] || 0) : tickets.filter(t => t.epic === e.id).length,
    ]),
  );
  $: noEpicCount = summary?.byEpic
    ? (summary.byEpic.none || 0)
    : tickets.filter(t => !t.epic).length;
  // done/total story points per epic — the sprint strip's burn numbers, one
  // level down (tas-HnASryio). Server-computed, so unlike the `tickets`
  // fallbacks these stay correct when only page 1 is loaded. No fallback: a
  // burn figure derived from one page is worse than no burn figure.
  //
  // Zero-point epics fall back too: "0/0" reads as "nothing here" when the epic
  // may hold plenty of unestimated tickets, so the plain count is more honest.
  $: epicBurn = new Map(
    epics.map(e => {
      const b = summary?.pointsByEpic?.[e.id];
      return [e.id, b && b.total > 0 ? b : null];
    }),
  );
  $: userCounts = new Map(
    users.map(u => [
      u.id,
      summary?.byAssignee ? (summary.byAssignee[u.id] || 0) : tickets.filter(t => t.assignee === u.id).length,
    ]),
  );
  $: unassignedCount = summary?.byAssignee
    ? (summary.byAssignee.none || 0)
    : tickets.filter(t => !t.assignee).length;

  function onCliToggle(e: Event) {
    const t = e.currentTarget as HTMLInputElement;
    cliDisabled.set(t.checked);
  }

  function selectView(v: 'board' | 'list') { dispatch('view', v); }
  function switchSprint() { dispatch('switchSprint'); }
  function manageWorkspace() { if (workspace) dispatch('manageSprint', workspace.id); }
  function newSprint() { dispatch('newSprint'); }
  function selectAllEpics() { dispatch('epic', 'all'); }
  function selectNoEpic() { dispatch('epic', 'none'); }
  function openEpicPanel(id: string) { dispatch('manageEpic', id); }
  function toggleEpicFilter(id: string) {
    dispatch('epic', activeEpic === id ? 'all' : id);
  }
  function newEpic() { dispatch('newEpic'); }
  function selectAllUsers() { dispatch('user', 'all'); }
  function selectUnassigned() { dispatch('user', 'none'); }
  function openUserPanel(id: string) { dispatch('manageUser', id); }
  function toggleUserFilter(id: string) {
    dispatch('user', activeUser === id ? 'all' : id);
  }
  function openPalette() { dispatch('palette'); }
  function openTriage() { dispatch('triage'); }
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

  function onDrop(kind: 'clear-epic' | 'epic' | 'clear-user' | 'user', id?: string) {
    return async (e: DragEvent) => {
      e.preventDefault();
      dragOverKey = null;
      const tid = $draggingTicketId;
      draggingTicketId.set(null);
      if (!tid) return;
      if (kind === 'clear-epic') await persistTicket(tid, { epic: null });
      else if (kind === 'epic') await persistTicket(tid, { epic: id });
      else if (kind === 'clear-user') await persistTicket(tid, { assignee: null });
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

  <div class="workspace">
    <button class="ws-main" class:active={switcherOpen} on:click={switchSprint} title="Switch sprint">
      <span class="dot" style="background:{workspace ? sprintDotColor(workspace.status) : unsorted ? 'var(--surface-3)' : 'var(--faint)'}"></span>
      <div class="ws-meta">
        <div class="ws-kicker">Sprint</div>
        <div class="ws-name">{workspace ? workspace.name : unsorted ? 'Unsorted' : 'No sprint selected'}</div>
      </div>
      <span class="ws-switch">Switch</span>
    </button>
    {#if workspace}
      <button class="icon-btn" title="Edit sprint" on:click={manageWorkspace}><SettingsIcon size={12} /></button>
    {/if}
    <button class="icon-btn" title="New sprint" on:click={newSprint}><Plus size={12} /></button>
  </div>

  <div class="section-label">
    <span>Epics</span>
    <button class="icon-btn" title="New epic" on:click={newEpic}><Plus size={12} /></button>
  </div>
  <div class="section-list" style="max-height:220px">
    <!--
      No drop handler here: "All tickets" is a view, not a bucket, so dropping
      on it never had a meaning matching its label. The clear-epic target lives
      on the "No epic" row below, which is what it actually does (tas-nuu2zscR).
    -->
    <button
      style={rowStyle(activeEpic === 'all' && !panel, 'all-epic')}
      on:click={selectAllEpics}
    >
      <span class="dot" style="background:var(--faint)"></span>
      <span class="row-label">All tickets</span>
      <span class="mono count">{totalCount}</span>
    </button>
    {#each epics as ep (ep.id)}
      {@const burn = epicBurn.get(ep.id) || null}
      <div
        class="row"
        role="button"
        tabindex="-1"
        style={dragOverKey === `ep:${ep.id}` ? 'background:rgba(76,141,255,.13);box-shadow:inset 0 0 0 1px #4c8dff;' : ''}
        on:dragover={onDragOver(`ep:${ep.id}`)}
        on:dragleave={onDragLeave}
        on:drop={onDrop('epic', ep.id)}
      >
        <!--
          The name filters the board; editing moved to the small button on the
          right. It used to be the other way round, which put the rarer action
          on the bigger target — you pick an epic to look at its tickets far
          more often than to rename it (tas-StJGUFto).
        -->
        <button
          class="row-main"
          class:active={activeEpic === ep.id}
          style="color:{activeEpic === ep.id ? 'var(--text)' : 'var(--muted)'};font-weight:{activeEpic === ep.id ? 600 : 400};background:{activeEpic === ep.id ? 'var(--nav-active)' : 'transparent'}"
          title={activeEpic === ep.id ? 'Clear epic filter' : 'Filter board to this epic'}
          on:click={() => toggleEpicFilter(ep.id)}
        >
          <span class="dot" style="background:{ep.color || 'var(--faint)'}"></span>
          <span class="row-label">{ep.name}</span>
        </button>
        {#if burn}
          <span
            class="mono burn"
            class:complete={burn.total > 0 && burn.done === burn.total}
            title="{burn.done} of {burn.total} story points done"
          >{burn.done}/{burn.total}</span>
        {:else}
          <span class="mono count">{epicCounts.get(ep.id) || 0}</span>
        {/if}
        <button
          class="filter-btn"
          title="Edit epic"
          aria-label="Edit epic {ep.name}"
          on:click={() => openEpicPanel(ep.id)}
        >
          <Edit size={11} />
        </button>
      </div>
    {/each}
    <!--
      Also rendered whenever any epic exists, even at zero count: it's the drop
      target for clearing a ticket's epic, so hiding it would leave drag-to-
      ungroup with nowhere to land.
    -->
    {#if noEpicCount > 0 || activeEpic === 'none' || epics.length > 0}
      <button
        style={rowStyle(activeEpic === 'none' && !panel, 'none-epic')}
        on:click={selectNoEpic}
        on:dragover={onDragOver('none-epic')}
        on:dragleave={onDragLeave}
        on:drop={onDrop('clear-epic')}
      >
        <span class="dot" style="background:var(--surface-3)"></span>
        <span class="row-label">No epic</span>
        <span class="mono count">{noEpicCount}</span>
      </button>
    {/if}
    {#if epics.length === 0}
      <div class="epics-empty">
        {#if unsorted}
          These tickets have no sprint. Move them into one from the ticket panel, or group them with an epic.
        {:else}
          No epics yet — group this sprint's tickets by creating one.
        {/if}
      </div>
    {/if}
  </div>

  <div class="section-label">
    <span>People</span>
    <button class="icon-btn" title="Add person" on:click={newUser}><Plus size={12} /></button>
  </div>
  <div class="section-list" style="flex:1;padding-bottom:8px">
    <!--
      No drop target on "Everyone" — dropping a ticket on it cleared the
      assignee, which never matched the label. Clearing lives on the
      "Unassigned" row below, which is what it actually does (mirrors the
      epic section's clear-target move in tas-nuu2zscR).
    -->
    <button
      style={rowStyle(activeUser === 'all' && !panel, 'all-user')}
      on:click={selectAllUsers}
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
    <!--
      TriagePanel's unassigned finding sets this filter, but until now nothing
      rendered for it: "Everyone" went un-highlighted, so the board looked
      unfiltered while silently hiding every assigned ticket — including each
      one the create panel had just self-assigned (bug-C7mpZAvb). Always
      rendered, like "No epic": it's also the drop target for unassigning.
    -->
    <button
      style={rowStyle(activeUser === 'none' && !panel, 'none-user')}
      on:click={selectUnassigned}
      on:dragover={onDragOver('none-user')}
      on:dragleave={onDragLeave}
      on:drop={onDrop('clear-user')}
    >
      <span class="avatar" style="background:var(--surface-3);color:var(--muted);font-weight:600">?</span>
      <span class="row-label">Unassigned</span>
      <span class="mono count">{unassignedCount}</span>
    </button>
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
    <div class="settings-slot" bind:this={settingsEl}>
      <button
        class="theme-btn"
        title="Settings"
        aria-haspopup="dialog"
        aria-expanded={settingsOpen}
        on:click={() => (settingsOpen = !settingsOpen)}
      >
        <SettingsIcon size={14} />
      </button>
      {#if settingsOpen}
        <div class="settings" role="dialog" aria-label="Settings">
          <div class="settings-head">Settings</div>
          <label class="settings-row">
            <div class="settings-meta">
              <div class="settings-name">Disable Claude CLI</div>
              <div class="settings-hint">
                {#if !$claudeConfig?.available}
                  CLI not detected on server — actions already copy prompts to your clipboard.
                {:else}
                  Force the copy-paste fallback. Actions copy the prompt to your clipboard instead of spawning claude on the server.
                {/if}
              </div>
            </div>
            <span class="switch" class:on={$cliDisabled}>
              <input
                type="checkbox"
                checked={$cliDisabled}
                on:change={onCliToggle}
              />
              <span class="switch-thumb"></span>
            </span>
          </label>
        </div>
      {/if}
    </div>
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
  .workspace {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 14px 12px 2px;
    padding: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 9px;
  }
  .ws-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .ws-main:hover { background: var(--surface-hover); }
  .ws-main.active { background: var(--nav-active); }
  .ws-meta { flex: 1; min-width: 0; }
  .ws-kicker {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: .07em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .ws-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ws-switch {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent);
    padding: 2px 6px;
    border-radius: 5px;
    background: rgba(76,141,255,.1);
    flex: none;
  }
  .epics-empty {
    padding: 8px 10px;
    font-size: 11px;
    color: var(--faint);
    line-height: 1.4;
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
  .burn {
    font-family: 'IBM Plex Mono';
    font-size: 10px;
    color: var(--muted);
    padding: 0 6px;
    white-space: nowrap;
  }
  .burn.complete { color: #46c17f; }
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
  .settings-slot {
    position: static;
    display: flex;
    align-items: center;
  }
  .settings {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 8px;
    right: 8px;
    background: var(--elevated, var(--surface));
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,.35);
    padding: 6px;
    z-index: 20;
  }
  .settings-head {
    padding: 6px 10px 4px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .settings-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .settings-row:hover { background: var(--surface-hover); }
  .settings-meta { flex: 1; min-width: 0; }
  .settings-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
  }
  .settings-hint {
    font-size: 11px;
    color: var(--faint);
    margin-top: 2px;
    line-height: 1.35;
  }
  .switch {
    position: relative;
    display: inline-block;
    width: 30px;
    height: 18px;
    border-radius: 9px;
    background: var(--chip);
    transition: background .12s;
    flex: none;
  }
  .switch.on { background: var(--accent, #4c8dff); }
  .switch input {
    position: absolute;
    inset: 0;
    opacity: 0;
    margin: 0;
    cursor: pointer;
  }
  .switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    transition: transform .12s;
    box-shadow: 0 1px 2px rgba(0,0,0,.25);
  }
  .switch.on .switch-thumb { transform: translateX(12px); }
</style>
