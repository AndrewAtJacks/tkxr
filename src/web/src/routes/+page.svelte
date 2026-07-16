<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, onMount } from 'svelte';
  import type { Sprint, Ticket, User } from '../lib/stores';
  import { sprintStore, ticketStore, userStore, claudeConfig } from '../lib/stores';
  import { activeRunId } from '../lib/claudeRun';
  import { normalizeTicket, PRIORITY_ORDER } from '../lib/util';

  import Sidebar from '../lib/Sidebar.svelte';
  import Toolbar from '../lib/Toolbar.svelte';
  import SprintStrip from '../lib/SprintStrip.svelte';
  import Board from '../lib/Board.svelte';
  import ListView from '../lib/ListView.svelte';
  import WorkspacePanel from '../lib/WorkspacePanel.svelte';
  import TicketPanel from '../lib/TicketPanel.svelte';
  import SprintPanel from '../lib/SprintPanel.svelte';
  import UserPanel from '../lib/UserPanel.svelte';
  import TriagePanel from '../lib/TriagePanel.svelte';
  import ClaudeRunPanel from '../lib/ClaudeRunPanel.svelte';
  import CommandPalette from '../lib/CommandPalette.svelte';
  import Toaster from '../lib/Toaster.svelte';

  type Panel = null | 'ticket' | 'sprint' | 'user' | 'triage';
  let view: 'board' | 'list' = 'board';
  let activeSprint: string = 'all';
  let activeUser: string = 'all';
  let typeFilter: 'all' | 'task' | 'bug' = 'all';
  let sortBy = 'updated';
  let search = '';
  let panel: Panel = null;
  let isCreate = false;
  let selectedTicketId: string | null = null;
  let selectedSprintId: string | null = null;
  let selectedUserId: string | null = null;
  let paletteOpen = false;
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
        activeSprint = j.activeSprint || 'all';
        activeUser = j.activeUser || 'all';
        typeFilter = j.typeFilter || 'all';
        sortBy = j.sortBy || 'updated';
        search = j.search || '';
      }
    } catch { /* noop */ }
  }
  $: if (browser) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ view, activeSprint, activeUser, typeFilter, sortBy, search }));
    } catch { /* noop */ }
  }

  // If the selected sprint/user disappears (deleted from another client or CLI),
  // fall back to 'all' so the board doesn't silently go empty. Also close any
  // open panel targeting the now-deleted entity so we don't render stale state.
  $: if (activeSprint !== 'all' && activeSprint !== 'none'
      && $sprintStore.length > 0
      && !($sprintStore as Sprint[]).some(s => s.id === activeSprint)) {
    activeSprint = 'all';
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
    reload();
    setupWs();
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  });

  onDestroy(() => {
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    if (ws) ws.close();
  });

  async function reload() {
    try {
      const [tRes, sRes, uRes, cRes, ccRes] = await Promise.all([
        fetch('/api/tickets'),
        fetch('/api/sprints'),
        fetch('/api/users'),
        fetch('/api/config'),
        fetch('/api/comments/counts'),
      ]);
      if (tRes.ok) {
        const tickets = (await tRes.json()).map(normalizeTicket);
        ticketStore.set(tickets);
      }
      if (sRes.ok) sprintStore.set(await sRes.json());
      if (uRes.ok) userStore.set(await uRes.json());
      if (cRes.ok) {
        const j = await cRes.json();
        if (j.version) version = `v${j.version}`;
        // Populate the claude CLI capability store so downstream panels
        // (tas-T8ZXseeD et al.) can branch between "Run in Claude" and
        // `copyPrompt` (clipboard.ts) from first paint. Docs §5.
        if (j.claude) claudeConfig.set(j.claude);
        else claudeConfig.set({ available: false, bin: '' });
      }
      if (ccRes.ok) {
        commentCounts = await ccRes.json();
      }
    } catch { /* noop */ }
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
    if (e.key === '/') { e.preventDefault(); const el = document.getElementById('toolbar-search') as HTMLInputElement | null; el?.focus(); return; }
    if (e.key.toLowerCase() === 'c') { e.preventDefault(); newTicket(); }
    if (e.key.toLowerCase() === 'b') { view = 'board'; panel = null; }
    if (e.key.toLowerCase() === 'l') { view = 'list'; panel = null; }
  }

  // Filters
  $: filtered = ($ticketStore as Ticket[])
    .filter(t => {
      if (activeSprint === 'all') { /* no filter */ }
      else if (activeSprint === 'none') { if (t.sprint) return false; }
      else if (t.sprint !== activeSprint) return false;

      if (activeUser === 'all') { /* no filter */ }
      else if (activeUser === 'none') { if (t.assignee) return false; }
      else if (t.assignee !== activeUser) return false;

      if (typeFilter !== 'all' && t.type !== typeFilter) return false;

      if (search) {
        const q = search.toLowerCase();
        const hay = `${t.title} ${t.description || ''} ${t.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'title': return a.title.localeCompare(b.title);
        case 'created': return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'priority': {
          const av = PRIORITY_ORDER[a.priority || 'medium'];
          const bv = PRIORITY_ORDER[b.priority || 'medium'];
          if (av !== bv) return av - bv;
          if (a.type === 'bug' && b.type === 'task') return -1;
          if (a.type === 'task' && b.type === 'bug') return 1;
          return 0;
        }
        case 'updated':
        default: return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });

  $: contextTitle = (() => {
    if (activeSprint !== 'all' && activeSprint !== 'none') {
      const s = $sprintStore.find((sp: Sprint) => sp.id === activeSprint);
      return s?.name || 'Sprint';
    }
    if (activeUser !== 'all' && activeUser !== 'none') {
      const u = $userStore.find((x: User) => x.id === activeUser);
      return u?.displayName || 'Person';
    }
    return 'All tickets';
  })();

  $: contextSubtitle = (() => {
    if (activeSprint !== 'all' && activeSprint !== 'none') {
      const s = $sprintStore.find((sp: Sprint) => sp.id === activeSprint);
      return s?.goal || '';
    }
    if (activeUser !== 'all' && activeUser !== 'none') {
      const u = $userStore.find((x: User) => x.id === activeUser);
      return u ? `@${u.username}` : '';
    }
    return '';
  })();

  // Sprint burn strip
  $: burn = (() => {
    if (activeSprint === 'all' || activeSprint === 'none') return null;
    const scoped = ($ticketStore as Ticket[]).filter(t => t.sprint === activeSprint);
    const total = scoped.reduce((s, t) => s + (t.estimate || 0), 0);
    const done = scoped.filter(t => t.status === 'done').reduce((s, t) => s + (t.estimate || 0), 0);
    return { done, total };
  })();

  // Triage findings count (rough, drives sidebar pill)
  $: triageCount = (() => {
    const open = ($ticketStore as Ticket[]).filter(t => t.status !== 'done');
    let n = 0;
    if (open.some(t => !t.assignee)) n++;
    if (open.some(t => t.priority === 'critical')) n++;
    if (open.filter(t => t.status === 'backlog').length >= 4) n++;
    return n;
  })();

  // Panel actions
  function openTicket(id: string) {
    selectedTicketId = id;
    isCreate = false;
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
    selectedUserId = null;
    isCreate = false;
  }

  $: activeTicket = selectedTicketId ? ($ticketStore as Ticket[]).find(t => t.id === selectedTicketId) || null : null;
  $: activeSprintSel = selectedSprintId ? ($sprintStore as Sprint[]).find(s => s.id === selectedSprintId) || null : null;
  $: activeUserSel = selectedUserId ? ($userStore as User[]).find(u => u.id === selectedUserId) || null : null;
</script>

<svelte:head>
  <title>tkxr — Dashboard</title>
</svelte:head>

<div class="app">
  <Sidebar
    {version}
    {view}
    {activeSprint}
    {activeUser}
    sprints={$sprintStore}
    users={$userStore}
    tickets={$ticketStore}
    {triageCount}
    {panel}
    on:view={(e) => { view = e.detail; panel = null; }}
    on:sprint={(e) => { activeSprint = e.detail; panel = null; }}
    on:user={(e) => { activeUser = e.detail; panel = null; }}
    on:palette={() => paletteOpen = true}
    on:triage={openTriage}
    on:newSprint={newSprint}
    on:newUser={newUser}
    on:manageSprint={(e) => openSprintPanel(e.detail)}
    on:manageUser={(e) => openUserPanel(e.detail)}
    on:reload={reload}
  />

  <main class="main">
    <Toolbar
      title={contextTitle}
      subtitle={contextSubtitle}
      shown={filtered.length}
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
          tickets={filtered}
          sprints={$sprintStore}
          users={$userStore}
          {commentCounts}
          on:open={(e) => openTicket(e.detail)}
          on:reload={reload}
        />
      {:else}
        <ListView
          tickets={filtered}
          sprints={$sprintStore}
          users={$userStore}
          on:open={(e) => openTicket(e.detail)}
        />
      {/if}
    </div>
  </main>
</div>

<WorkspacePanel open={panel !== null} on:close={closePanel}>
  {#if panel === 'ticket'}
    {#key selectedTicketId || 'new'}
      <TicketPanel
        ticket={activeTicket}
        {isCreate}
        sprints={$sprintStore}
        users={$userStore}
        allTickets={$ticketStore}
        defaultSprint={activeSprint !== 'all' && activeSprint !== 'none' ? activeSprint : null}
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
        tickets={$ticketStore}
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
      on:reload={reload}
      on:close={closePanel}
      on:openSprint={(e) => openSprintPanel(e.detail)}
      on:applyFilter={(e) => {
        const p = e.detail || {};
        if (p.assignee === 'none') activeUser = 'none';
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
