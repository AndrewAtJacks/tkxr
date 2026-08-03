<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, onMount } from 'svelte';
  import type { Epic, PagedTicketQuery, Sprint, Ticket, TicketSortBy, User } from '../lib/stores';
  import { pagedTickets, sprintStore, epicStore, ticketStore, userStore, claudeConfig, ghConfig } from '../lib/stores';
  import { activeRunId } from '../lib/claudeRun';

  // Local aliases so Svelte's `$store` auto-subscription can reach into the
  // paged store's derived fields (auto-subscription only works on top-level
  // identifiers, not on `pagedTickets.items`).
  const pagedItems = pagedTickets.items;
  const pagedTotal = pagedTickets.total;
  // Surface the store's loading flag to the Toolbar so it can show a small
  // spinner while the debounced search / chip changes fetch page 1 from the
  // server (tas-JC34zKX5).
  const pagedLoading = pagedTickets.loading;

  import Sidebar from '../lib/Sidebar.svelte';
  import Toolbar from '../lib/Toolbar.svelte';
  import SprintStrip from '../lib/SprintStrip.svelte';
  import Board from '../lib/Board.svelte';
  import ListView from '../lib/ListView.svelte';
  import WorkspacePanel from '../lib/WorkspacePanel.svelte';
  import TicketPanel from '../lib/TicketPanel.svelte';
  import SprintPanel from '../lib/SprintPanel.svelte';
  import SprintSwitcher from '../lib/SprintSwitcher.svelte';
  import EpicPanel from '../lib/EpicPanel.svelte';
  import UserPanel from '../lib/UserPanel.svelte';
  import TriagePanel from '../lib/TriagePanel.svelte';
  import ClaudeRunPanel from '../lib/ClaudeRunPanel.svelte';
  import CommandPalette from '../lib/CommandPalette.svelte';
  import Toaster from '../lib/Toaster.svelte';
  import { normalizeTicket } from '../lib/util';

  type Panel = null | 'ticket' | 'sprint' | 'epic' | 'user' | 'triage';
  let view: 'board' | 'list' = 'board';
  // `activeSprint` is now the *workspace* — the sprint that frames the whole
  // board. '' means no workspace picked yet (→ the SprintSwitcher gate).
  // The literal `none` is the "Unsorted" pseudo-workspace: tickets that have
  // no sprint at all. Without it, pre-existing sprintless tickets (and any
  // ticket orphaned by deleting a sprint) would be unreachable from the UI —
  // the storage + API layers already understand `sprint=none`.
  const UNSORTED = 'none';
  let activeSprint: string = '';
  // `activeEpic` is the in-workspace grouping filter that replaced the old
  // sprint-as-filter role. 'all' = show every epic, 'none' = tickets with no
  // epic, or a specific epic id.
  let activeEpic: string = 'all';
  let activeUser: string = 'all';
  let typeFilter: 'all' | 'task' | 'bug' = 'all';
  let sortBy = 'updated';
  let search = '';
  // Explicit "switch sprint" view (the separate workspace picker). The gate
  // also renders SprintSwitcher whenever no valid workspace is active.
  let showSwitcher = false;
  let panel: Panel = null;
  let isCreate = false;
  let selectedTicketId: string | null = null;
  let selectedSprintId: string | null = null;
  let selectedEpicId: string | null = null;
  let selectedUserId: string | null = null;
  // Fallback for tickets not in the current paged slice (Board columns +
  // main list each hold their own page; `$ticketStore` mirrors only the main
  // page). Populated via `/api/tickets/id/:id` before mounting the panel.
  let openedTicket: Ticket | null = null;
  let paletteOpen = false;
  // Set once the first `reload()` resolves. Declared up here (rather than next
  // to its reactive consumer) so the store-loaded guards below can read it.
  let mounted = false;
  let version = '';
  let commentCounts: Record<string, number> = {};

  let ws: WebSocket | null = null;
  let wsReconnectTimer: number | null = null;

  const SETTINGS_KEY = 'tkxr-ui';
  if (browser) {
    try {
      const s = localStorage.getItem(SETTINGS_KEY);
      if (s) {
        const j = JSON.parse(s);
        view = j.view || 'board';
        // `all` was the pre-workspace value, when `activeSprint` was just a
        // filter. It's not a sprint id, so the reset guard below (which needs
        // `$sprintStore.length > 0`) can't clear it in a project with zero
        // sprints — it would survive and get re-persisted. Map it to "no
        // workspace picked" on the way in instead.
        activeSprint = j.activeSprint === 'all' ? '' : (j.activeSprint || '');
        activeEpic = j.activeEpic || 'all';
        activeUser = j.activeUser || 'all';
        typeFilter = j.typeFilter || 'all';
        sortBy = j.sortBy || 'updated';
        search = j.search || '';
      }
    } catch { /* noop */ }
  }
  $: if (browser) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ view, activeSprint, activeEpic, activeUser, typeFilter, sortBy, search }));
    } catch { /* noop */ }
  }

  // The Unsorted pseudo-workspace has no backing Sprint record.
  $: isUnsorted = activeSprint === UNSORTED;
  // The active workspace resolved from the current sprint id. Null → gate,
  // unless we're in Unsorted (which is a valid workspace with no Sprint row).
  $: workspaceSprint = activeSprint && !isUnsorted
    ? ($sprintStore as Sprint[]).find(s => s.id === activeSprint) || null
    : null;
  $: hasWorkspace = isUnsorted || !!workspaceSprint;
  // Epics scoped to the active workspace drive the sidebar grouping + filter.
  // Unsorted collects the epics that aren't attached to any sprint.
  $: workspaceEpics = ($epicStore as Epic[]).filter(e => (isUnsorted ? !e.sprint : e.sprint === activeSprint));

  // If the active workspace sprint disappears (deleted elsewhere) drop back to
  // the gate rather than silently showing an empty board. Unsorted is exempt —
  // it never has a Sprint record to look up.
  // (Compares against UNSORTED inline rather than reading `isUnsorted` — going
  // through the derived value would make this a cyclical reactive dependency.)
  $: if (activeSprint
      && activeSprint !== UNSORTED
      && $sprintStore.length > 0
      && !($sprintStore as Sprint[]).some(s => s.id === activeSprint)) {
    activeSprint = '';
  }
  // If the active epic filter points at an epic that no longer exists (deleted
  // or belongs to another workspace), clear it back to "all". Gated on
  // `mounted` — the old `$epicStore.length >= 0` was always true, so on first
  // mount (empty store) this wiped the epic filter restored from localStorage
  // before `/api/epics` had resolved. `mounted` is set after the first
  // `reload()`, which is a real "epics have loaded" signal and, unlike the
  // sibling guards' `> 0` proxy, still fires once the last epic is deleted.
  $: if (activeEpic !== 'all' && activeEpic !== 'none'
      && mounted
      && !workspaceEpics.some(e => e.id === activeEpic)) {
    activeEpic = 'all';
  }
  $: if (selectedEpicId !== null
      && ($epicStore as Epic[]).length > 0
      && !($epicStore as Epic[]).some(e => e.id === selectedEpicId)) {
    selectedEpicId = null;
    if (panel === 'epic') panel = null;
  }
  $: if (activeUser !== 'all' && activeUser !== 'none'
      && $userStore.length > 0
      && !($userStore as User[]).some(u => u.id === activeUser)) {
    activeUser = 'all';
  }
  $: if (selectedUserId !== null
      && ($userStore as User[]).length > 0
      && !($userStore as User[]).some(u => u.id === selectedUserId)) {
    selectedUserId = null;
    if (panel === 'user') panel = null;
  }
  $: if (selectedSprintId !== null
      && ($sprintStore as Sprint[]).length > 0
      && !($sprintStore as Sprint[]).some(s => s.id === selectedSprintId)) {
    selectedSprintId = null;
    if (panel === 'sprint') panel = null;
  }

  onMount(() => {
    reload().then(() => { mounted = true; });
    setupWs();
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  });

  onDestroy(() => {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (ws) ws.close();
  });

  // Build the paged-store query from the current UI filter state. Kept in one
  // place so `reload()`, the reactive filter-change handler, and any imperative
  // callers stay in lockstep. The server (tas-AEduZ-wc) handles filtering +
  // sorting; we no longer touch the ticket array on the client.
  function currentQuery(): PagedTicketQuery {
    const q: PagedTicketQuery = {};
    if (search) q.q = search;
    // The board is always scoped to the active workspace sprint.
    if (activeSprint) q.sprint = activeSprint;
    if (activeEpic !== 'all') q.epic = activeEpic; // 'none' passed through
    if (activeUser !== 'all') q.assignee = activeUser;   // 'none' passed through
    if (typeFilter !== 'all') q.type = typeFilter;
    q.sortBy = sortBy as TicketSortBy;
    return q;
  }

  async function reload() {
    // Ticket page 1 goes through the paged store; the rest are unchanged
    // reference-data fetches. Kicking them off in parallel keeps latency close
    // to the pre-paging bulk-load.
    const ticketsP = pagedTickets.resetAndFetch(currentQuery());
    try {
      const [sRes, eRes, uRes, cRes, ccRes] = await Promise.all([
        fetch('/api/sprints'),
        fetch('/api/epics'),
        fetch('/api/users'),
        fetch('/api/config'),
        fetch('/api/comments/counts'),
      ]);
      if (sRes.ok) sprintStore.set(await sRes.json());
      if (eRes.ok) epicStore.set(await eRes.json());
      if (uRes.ok) userStore.set(await uRes.json());
      if (cRes.ok) {
        const j = await cRes.json();
        if (j.version) version = `v${j.version}`;
        // Populate the claude CLI capability store so downstream panels
        // (tas-T8ZXseeD et al.) can branch between "Run in Claude" and
        // `copyPrompt` (clipboard.ts) from first paint. Docs §5.
        if (j.claude) claudeConfig.set(j.claude);
        else claudeConfig.set({ available: false, bin: '' });
        // Populate the gh CLI capability store so BranchInsights can gate
        // the "Push + open PR" button on availability + auth.
        if (j.gh) ghConfig.set(j.gh);
        else ghConfig.set({ available: false, authenticated: false });
      }
      if (ccRes.ok) {
        commentCounts = await ccRes.json();
      }
    } catch { /* noop */ }
    await ticketsP;
  }

  // Any UI filter/sort/search change refetches page 1 with the new query.
  // The server owns filtering + sorting now, so this is the only place that
  // needs to react — the old client-side filter block is gone. We gate on
  // `mounted` so the initial `reload()` (which itself does the first fetch)
  // isn't racing with this reactive statement's mount-time fire.
  $: if (browser && mounted) {
    // Read all filter inputs so Svelte tracks them, then fire-and-forget.
    void activeSprint; void activeEpic; void activeUser; void typeFilter; void sortBy; void search;
    pagedTickets.resetAndFetch(currentQuery());
  }

  async function refreshCommentCounts() {
    try {
      const res = await fetch('/api/comments/counts');
      if (res.ok) commentCounts = await res.json();
    } catch { /* noop */ }
  }

  function setupWs() {
    if (!browser) return;
    if (ws) { try { ws.close(); } catch { /* noop */ } }
    try {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${window.location.host}`);
      ws.onmessage = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.type === 'pong') return;
          // Comment events don't change tickets/sprints/users — refresh counts only.
          if (m.type === 'comment_created' || m.type === 'comment_deleted') {
            refreshCommentCounts();
            return;
          }
          // Paged-aware ticket handling (tas-98YN7GqK): let the paged store patch
          // its own visible slice instead of dropping every loaded page with a
          // bulk `reload()`. Sidebar/triage summary counts are handled by
          // `Sidebar.svelte`'s own subscription to the shared `ticketEvents.ts`
          // bus (with 500ms coalescing), so nothing to do for that here.
          if (m.type === 'ticket_created' || m.type === 'ticket_updated' || m.type === 'ticket_deleted') {
            pagedTickets.applyEvent(m);
            // The burn strip reads its own scoped slice, so it isn't covered by
            // `applyEvent` — re-sum it whenever ticket data moves.
            if (activeSprint && !isUnsorted) fetchBurn(activeSprint);
            return;
          }
          // Sprint/user events still trigger the bulk reference-data refresh
          // (sprintStore, userStore) — cheap fetches, and the paged store's
          // filter view depends on their current shape.
          reload();
        } catch { /* noop */ }
      };
      ws.onclose = () => {
        wsReconnectTimer = window.setTimeout(setupWs, 3000);
      };
    } catch { /* noop */ }
  }

  function onGlobalKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as any).isContentEditable);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    if (typing) return;
    // Bare-letter shortcuts only. Without this guard Ctrl/Cmd+C was caught by
    // the `c` case below, so copying a selected ticket id closed the panel and
    // opened the create form instead (tas-PchLjBAh). Same for Ctrl+B / Ctrl+L.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') { e.preventDefault(); const el = document.getElementById('toolbar-search') as HTMLInputElement | null; el?.focus(); return; }
    if (e.key.toLowerCase() === 'c') { e.preventDefault(); newTicket(); }
    if (e.key.toLowerCase() === 'b') { view = 'board'; panel = null; }
    if (e.key.toLowerCase() === 'l') { view = 'list'; panel = null; }
  }

  // Filtering + sorting live on the server now (tas-AEduZ-wc). The paged
  // store already holds the current page in server order; we just re-alias it
  // as `filtered` so the existing template bindings stay put.
  $: filtered = $pagedItems as Ticket[];

  // Board owns its own per-column paged stores (tas-MKYRoS6x) and takes the
  // toolbar filter state as a `query` prop; recompute it reactively so the
  // Board's five column stores reset together on any filter change.
  $: boardQuery = (() => {
    // Re-reference to make Svelte tracking explicit.
    void search; void activeSprint; void activeEpic; void activeUser; void typeFilter; void sortBy;
    const q: PagedTicketQuery = {};
    if (search) q.q = search;
    if (activeSprint) q.sprint = activeSprint;
    if (activeEpic !== 'all') q.epic = activeEpic;
    if (activeUser !== 'all') q.assignee = activeUser;
    if (typeFilter !== 'all') q.type = typeFilter;
    q.sortBy = sortBy as TicketSortBy;
    return q;
  })();

  // A person filter used to retitle the toolbar to their name. When epics
  // landed, `contextTitle` was rewritten around epic + workspace only, so the
  // sidebar highlight became the sole cue that a person filter was on — easy to
  // miss on a board that looks legitimately empty. Person wins the title when
  // set, because it's the narrowest of the three scopes (tas-nuu2zscR).
  $: activeUserObj = activeUser !== 'all' && activeUser !== 'none'
    ? ($userStore as User[]).find(u => u.id === activeUser) || null
    : null;
  $: activeEpicObj = activeEpic !== 'all' && activeEpic !== 'none'
    ? ($epicStore as Epic[]).find(ep => ep.id === activeEpic) || null
    : null;

  $: contextTitle = (() => {
    if (activeUserObj) return activeUserObj.displayName;
    if (activeUser === 'none') return 'Unassigned';
    if (activeEpicObj) return activeEpicObj.name;
    if (activeEpic === 'none') return 'No epic';
    if (isUnsorted) return 'Unsorted';
    return workspaceSprint?.name || 'Workspace';
  })();

  $: contextSubtitle = (() => {
    const base = isUnsorted ? 'Unsorted' : (workspaceSprint?.name || '');
    // With a person filter on, the subtitle carries the scope they're inside —
    // otherwise the title says a name and nothing says which epic/workspace.
    if (activeUserObj || activeUser === 'none') {
      const scope = activeEpicObj ? `${activeEpicObj.name} · ${base}` : base;
      return scope ? `in ${scope}` : '';
    }
    if (isUnsorted) return 'Tickets that belong to no sprint';
    if (activeEpicObj) return activeEpicObj.goal || base;
    return workspaceSprint?.goal || '';
  })();

  // Sprint burn strip.
  // `$ticketStore` can't back this: it's the paged slice, and since epics
  // landed it's *epic-filtered* too — summing it reported the active epic's
  // points under a "sprint progress" label. Fetch the workspace's own slice,
  // the way SprintPanel/EpicPanel do. Still capped at the same 200 as those
  // panels, so very large sprints under-count; tas-4MNJ9qP5 adds points to
  // `/api/tickets/summary`, which is the real fix.
  let burn: { done: number; total: number } | null = null;
  let burnAbort: AbortController | null = null;

  async function fetchBurn(sprintId: string) {
    if (burnAbort) burnAbort.abort();
    const ac = new AbortController();
    burnAbort = ac;
    try {
      const res = await fetch(`/api/tickets?sprint=${encodeURIComponent(sprintId)}&limit=200`, { signal: ac.signal });
      if (!res.ok) return;
      const j = await res.json();
      const items: any[] = Array.isArray(j) ? j : (j.items || []);
      const scoped = items.map(normalizeTicket) as Ticket[];
      burn = {
        total: scoped.reduce((s, t) => s + (t.estimate || 0), 0),
        done: scoped.filter(t => t.status === 'done').reduce((s, t) => s + (t.estimate || 0), 0),
      };
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      // noop — strip keeps its previous numbers
    } finally {
      if (burnAbort === ac) burnAbort = null;
    }
  }

  // Unsorted isn't a real sprint — there's nothing to burn down.
  $: if (browser) {
    if (!activeSprint || isUnsorted) burn = null;
    else fetchBurn(activeSprint);
  }

  // Triage findings count (rough, drives sidebar pill).
  // NOTE: same paged-store caveat as `burn` above — this is only fully accurate
  // once the sidebar pill switches to `/api/tickets/summary` (tas-4MNJ9qP5).
  $: triageCount = (() => {
    const open = ($ticketStore as Ticket[]).filter(t => t.status !== 'done');
    let n = 0;
    if (open.some(t => !t.assignee)) n++;
    if (open.some(t => t.priority === 'critical')) n++;
    if (open.filter(t => t.status === 'backlog').length >= 4) n++;
    return n;
  })();

  // Panel actions
  async function openTicket(id: string) {
    isCreate = false;
    // Resolve the ticket before mounting the panel so TicketPanel initializes
    // its draft from real data. If we set selectedTicketId first, {#key ...}
    // remounts with `ticket=null` and the draft locks in as empty ("undefined"
    // fields) even after the fetch resolves.
    let t = ($ticketStore as Ticket[]).find(x => x.id === id) || null;
    if (!t) {
      try {
        const res = await fetch(`/api/tickets/id/${encodeURIComponent(id)}`);
        if (res.ok) t = normalizeTicket(await res.json()) as Ticket;
      } catch { /* noop */ }
    }
    openedTicket = t;
    selectedTicketId = id;
    panel = 'ticket';
  }
  function newTicket() {
    selectedTicketId = null;
    isCreate = true;
    panel = 'ticket';
  }
  function openSprintPanel(id: string) {
    selectedSprintId = id;
    isCreate = false;
    panel = 'sprint';
  }
  function newSprint() {
    selectedSprintId = null;
    isCreate = true;
    panel = 'sprint';
  }
  function openEpicPanel(id: string) {
    selectedEpicId = id;
    isCreate = false;
    panel = 'epic';
  }
  function newEpic() {
    selectedEpicId = null;
    isCreate = true;
    panel = 'epic';
  }
  // Enter a workspace (sprint). Resets the in-workspace epic filter and closes
  // the switcher/gate.
  function selectWorkspace(id: string) {
    if (id !== activeSprint) activeEpic = 'all';
    activeSprint = id;
    showSwitcher = false;
    panel = null;
  }
  function openUserPanel(id: string) {
    selectedUserId = id;
    isCreate = false;
    panel = 'user';
  }
  function newUser() {
    selectedUserId = null;
    isCreate = true;
    panel = 'user';
  }
  function openTriage() {
    panel = 'triage';
  }
  function closePanel() {
    panel = null;
    selectedTicketId = null;
    selectedSprintId = null;
    selectedEpicId = null;
    selectedUserId = null;
    openedTicket = null;
    isCreate = false;
  }

  $: activeTicket = selectedTicketId
    ? (($ticketStore as Ticket[]).find(t => t.id === selectedTicketId)
        || (openedTicket && openedTicket.id === selectedTicketId ? openedTicket : null))
    : null;
  $: activeSprintSel = selectedSprintId ? ($sprintStore as Sprint[]).find(s => s.id === selectedSprintId) || null : null;
  $: activeEpicSel = selectedEpicId ? ($epicStore as Epic[]).find(e => e.id === selectedEpicId) || null : null;
  $: activeUserSel = selectedUserId ? ($userStore as User[]).find(u => u.id === selectedUserId) || null : null;

  // Show the workspace picker as a gate when no valid sprint is active, or on
  // demand when the user explicitly asks to switch. Wait for the first load
  // (`mounted`) so we don't flash the gate before sprints arrive.
  $: needWorkspace = mounted && !hasWorkspace;
  $: showWorkspacePicker = needWorkspace || showSwitcher;
</script>

<svelte:head>
  <title>tkxr — Dashboard</title>
</svelte:head>

<div class="app">
  <Sidebar
    {version}
    {view}
    {activeEpic}
    {activeUser}
    workspace={workspaceSprint}
    unsorted={isUnsorted}
    sprintScope={activeSprint}
    epics={workspaceEpics}
    users={$userStore}
    tickets={$ticketStore}
    {triageCount}
    {panel}
    switcherOpen={showSwitcher}
    on:view={(e) => { view = e.detail; panel = null; }}
    on:switchSprint={() => { showSwitcher = true; panel = null; }}
    on:epic={(e) => { activeEpic = e.detail; panel = null; }}
    on:user={(e) => { activeUser = e.detail; panel = null; }}
    on:palette={() => paletteOpen = true}
    on:triage={openTriage}
    on:newSprint={newSprint}
    on:newEpic={newEpic}
    on:newUser={newUser}
    on:manageSprint={(e) => openSprintPanel(e.detail)}
    on:manageEpic={(e) => openEpicPanel(e.detail)}
    on:manageUser={(e) => openUserPanel(e.detail)}
    on:reload={reload}
  />

  <main class="main">
    {#if showWorkspacePicker}
      <SprintSwitcher
        sprints={$sprintStore}
        {activeSprint}
        gate={needWorkspace}
        on:select={(e) => selectWorkspace(e.detail)}
        on:close={() => showSwitcher = false}
        on:reload={reload}
      />
    {:else}
      <Toolbar
        title={contextTitle}
        subtitle={contextSubtitle}
        shown={$pagedTotal}
        loading={$pagedLoading}
        {search}
        {typeFilter}
        {sortBy}
        on:search={(e) => search = e.detail}
        on:type={(e) => typeFilter = e.detail}
        on:sort={(e) => sortBy = e.detail}
        on:new={newTicket}
      />

      {#if burn}
        <SprintStrip done={burn.done} total={burn.total} />
      {/if}

      <div class="view">
        {#if view === 'board'}
          <Board
            query={boardQuery}
            epics={workspaceEpics}
            users={$userStore}
            {commentCounts}
            on:open={(e) => openTicket(e.detail)}
            on:reload={reload}
          />
        {:else}
          <ListView
            tickets={filtered}
            epics={workspaceEpics}
            users={$userStore}
            on:open={(e) => openTicket(e.detail)}
          />
        {/if}
      </div>
    {/if}
  </main>
</div>

<WorkspacePanel open={panel !== null} on:close={closePanel}>
  {#if panel === 'ticket'}
    {#key selectedTicketId || 'new'}
      <TicketPanel
        ticket={activeTicket}
        {isCreate}
        sprints={$sprintStore}
        epics={workspaceEpics}
        users={$userStore}
        allTickets={$ticketStore}
        defaultSprint={activeSprint && !isUnsorted ? activeSprint : null}
        defaultEpic={activeEpic !== 'all' && activeEpic !== 'none' ? activeEpic : null}
        defaultAssignee={activeUser !== 'all' && activeUser !== 'none' ? activeUser : null}
        on:reload={reload}
        on:close={closePanel}
        on:openTicket={(e) => openTicket(e.detail)}
      />
    {/key}
  {:else if panel === 'sprint'}
    {#key selectedSprintId || 'new'}
      <SprintPanel
        sprint={activeSprintSel}
        {isCreate}
        users={$userStore}
        on:reload={reload}
        on:close={closePanel}
        on:openTicket={(e) => openTicket(e.detail)}
      />
    {/key}
  {:else if panel === 'epic'}
    {#key selectedEpicId || 'new'}
      <EpicPanel
        epic={activeEpicSel}
        {isCreate}
        sprintId={activeSprint && !isUnsorted ? activeSprint : null}
        sprints={$sprintStore}
        users={$userStore}
        on:reload={reload}
        on:close={closePanel}
        on:openTicket={(e) => openTicket(e.detail)}
      />
    {/key}
  {:else if panel === 'user'}
    {#key selectedUserId || 'new'}
      <UserPanel
        user={activeUserSel}
        {isCreate}
        tickets={$ticketStore}
        on:reload={reload}
        on:close={closePanel}
        on:openTicket={(e) => openTicket(e.detail)}
      />
    {/key}
  {:else if panel === 'triage'}
    <TriagePanel
      tickets={$ticketStore}
      users={$userStore}
      sprints={$sprintStore}
      workspace={workspaceSprint}
      on:reload={reload}
      on:close={closePanel}
      on:openSprint={(e) => openSprintPanel(e.detail)}
      on:applyFilter={(e) => {
        const p = e.detail || {};
        if (p.assignee === 'none') activeUser = 'none';
        if (p.epic) activeEpic = p.epic;
        if (p.view) view = p.view;
        panel = null;
      }}
    />
  {/if}
</WorkspacePanel>

<!--
  Claude run panel — separate from the ticket/sprint/user/triage panel above.
  Opened automatically by `runPrompt` (claudeRun.ts) on the first successful
  run, and stays open until the user closes it via the header X. Downstream
  panels (TicketPanel/SprintPanel/TriagePanel — tas-*) trigger runs via the
  shared helper; they don't need to know this panel exists.
-->
<WorkspacePanel open={$activeRunId !== null} on:close={() => activeRunId.set(null)}>
  <ClaudeRunPanel on:close={() => activeRunId.set(null)} />
</WorkspacePanel>

<Toaster />

<CommandPalette
  open={paletteOpen}
  tickets={$ticketStore}
  users={$userStore}
  on:close={() => paletteOpen = false}
  on:view={(e) => { view = e.detail; panel = null; }}
  on:new={newTicket}
  on:triage={openTriage}
  on:openTicket={(e) => openTicket(e.detail)}
  on:reload={reload}
/>

<style>
  .app {
    display: flex;
    height: 100vh;
    overflow: hidden;
  }
  .main {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background: var(--bg);
  }
  .view {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
