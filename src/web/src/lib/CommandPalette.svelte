<script lang="ts">
  import { createEventDispatcher, tick, onDestroy } from 'svelte';
  import type { Ticket, User } from './stores';
  import Sparkles from './icons/Sparkles.svelte';
  import Columns from './icons/Columns.svelte';
  import List from './icons/List.svelte';
  import Plus from './icons/Plus.svelte';

  export let open = false;
  // `tickets` is retained for backwards-compat callers but no longer drives
  // the search results. Ticket lookups now hit `GET /api/tickets?q=&limit=20`
  // so the palette can find tickets outside the currently-loaded page once
  // the main store is paged (see tas-z-8q_Ljc / spr-6LhpAQQE).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let tickets: Ticket[] = [];
  // Reference it once so svelte-check doesn't flag the unused prop; parents
  // still bind it during the concurrent tas-RYc3-yIM ticketStore refactor.
  $: void tickets;
  export let users: User[] = [];

  const dispatch = createEventDispatcher();

  let query = '';
  let inputEl: HTMLInputElement;
  let matchedTickets: Ticket[] = [];
  let searching = false;

  // Debounce + in-flight cancellation. Each keystroke schedules a fetch 150ms
  // out; if a new keystroke lands before the timer fires, we reset both the
  // timer and the AbortController so only one request is in flight at a time.
  const SEARCH_DEBOUNCE_MS = 150;
  const SEARCH_LIMIT = 20;
  let searchTimer: number | null = null;
  let searchAbort: AbortController | null = null;
  // Monotonic counter guards against out-of-order resolution: a slow request
  // for "foo" must not overwrite results from a newer request for "foobar".
  let searchSeq = 0;

  $: if (open) tick().then(() => inputEl?.focus());
  $: parsed = parseNL(query, users);

  const quickActions = [
    { id: 'board', label: 'Go to Board', hint: 'B', icon: Columns, kind: 'view', payload: 'board' },
    { id: 'list', label: 'Go to List', hint: 'L', icon: List, kind: 'view', payload: 'list' },
    { id: 'new', label: 'New ticket', hint: 'C', icon: Plus, kind: 'new', payload: null },
    { id: 'triage', label: 'Open AI Triage', hint: '', icon: Sparkles, kind: 'triage', payload: null },
  ];

  // Re-run search whenever the query changes. Empty query clears results
  // immediately (no need to round-trip for an empty state).
  $: scheduleSearch(query);

  function scheduleSearch(q: string) {
    if (searchTimer !== null) { clearTimeout(searchTimer); searchTimer = null; }
    if (searchAbort) { searchAbort.abort(); searchAbort = null; }
    const trimmed = q.trim();
    if (!trimmed) {
      matchedTickets = [];
      searching = false;
      return;
    }
    searching = true;
    searchTimer = window.setTimeout(() => runSearch(trimmed), SEARCH_DEBOUNCE_MS);
  }

  async function runSearch(q: string) {
    const seq = ++searchSeq;
    const ac = new AbortController();
    searchAbort = ac;
    try {
      const url = `/api/tickets?q=${encodeURIComponent(q)}&limit=${SEARCH_LIMIT}`;
      const res = await fetch(url, { signal: ac.signal });
      if (!res.ok) return;
      const j = await res.json();
      // Ignore stale responses so a late-arriving reply for an older query
      // doesn't clobber the current one.
      if (seq !== searchSeq) return;
      // /api/tickets returns `{ items, nextCursor, total }` when any query param
      // is present; guard defensively in case that ever changes.
      matchedTickets = Array.isArray(j) ? j : (j.items || []);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
      // Silent failure — palette stays usable via quick actions + NL create.
    } finally {
      if (seq === searchSeq) {
        searching = false;
        searchAbort = null;
      }
    }
  }

  onDestroy(() => {
    if (searchTimer !== null) clearTimeout(searchTimer);
    if (searchAbort) searchAbort.abort();
  });

  $: matchedActions = query.trim()
    ? quickActions.filter(a => a.label.toLowerCase().includes(query.toLowerCase()))
    : quickActions;

  function parseNL(text: string, us: User[]) {
    const t = text.toLowerCase();
    if (text.trim().length < 3) return null;
    const type: 'task' | 'bug' = /\b(bug|error|crash|fail|broken)\b/.test(t) ? 'bug' : 'task';
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    if (/\bcritical\b/.test(t)) priority = 'critical';
    else if (/\bhigh\b|\burgent\b/.test(t)) priority = 'high';
    else if (/\blow\b|\bminor\b/.test(t)) priority = 'low';
    let assignee: User | null = null;
    for (const u of us) {
      const name = (u.displayName || '').toLowerCase();
      const uname = (u.username || '').toLowerCase();
      if (uname && t.includes('@' + uname)) { assignee = u; break; }
      if (name && t.includes(name.split(' ')[0])) { assignee = u; break; }
    }
    let title = text.replace(/\b(critical|high|urgent|low|minor|bug|task)\b:?/gi, '').trim();
    title = title.replace(/\s+/g, ' ').replace(/^[:\-\s]+/, '');
    if (title) title = title[0].toUpperCase() + title.slice(1);
    if (title.length < 3) return null;
    return { type, priority, assignee, title };
  }

  async function commitNL() {
    if (!parsed) return;
    try {
      const res = await fetch('/api/ai/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query, commit: true }),
      });
      if (res.ok) {
        const j = await res.json();
        dispatch('reload');
        dispatch('close');
        if (j.ticket) dispatch('openTicket', j.ticket.id);
      } else {
        localCommit();
      }
    } catch {
      localCommit();
    }
  }

  async function localCommit() {
    if (!parsed) return;
    try {
      const body: any = {
        type: parsed.type,
        title: parsed.title,
        priority: parsed.priority,
      };
      if (parsed.assignee) body.assignee = parsed.assignee.id;
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const t = await res.json();
        dispatch('reload');
        dispatch('close');
        dispatch('openTicket', t.id);
      }
    } catch { /* noop */ }
  }

  function runAction(a: any) {
    if (a.kind === 'view') dispatch('view', a.payload);
    else if (a.kind === 'new') dispatch('new');
    else if (a.kind === 'triage') dispatch('triage');
    dispatch('close');
  }

  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); dispatch('close'); }
    if (e.key === 'Enter') {
      if (parsed) { e.preventDefault(); commitNL(); return; }
      if (matchedTickets[0]) { e.preventDefault(); dispatch('openTicket', matchedTickets[0].id); dispatch('close'); return; }
      if (matchedActions[0]) { e.preventDefault(); runAction(matchedActions[0]); }
    }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="overlay" on:click={() => dispatch('close')} role="presentation"></div>
  <div class="palette" role="dialog" aria-modal="true">
    <div class="input-row">
      <Sparkles size={16} color="var(--ai)" />
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        placeholder="Search, jump, or describe a ticket to create…"
      />
      <span class="kbd">esc</span>
    </div>

    <div class="results">
      {#if parsed}
        <button class="row nl" on:click={commitNL}>
          <Plus size={14} color="var(--accent)" />
          <div class="nl-body">
            <div class="nl-title">Create {parsed.type} · {parsed.priority}</div>
            <div class="nl-sub">"{parsed.title}"{parsed.assignee ? ` · @${parsed.assignee.username}` : ''}</div>
          </div>
          <span class="kbd">↵</span>
        </button>
      {/if}

      {#each matchedActions as a}
        <button class="row" on:click={() => runAction(a)}>
          <svelte:component this={a.icon} size={14} color="var(--muted)" />
          <span class="row-label">{a.label}</span>
          {#if a.hint}<span class="kbd">{a.hint}</span>{/if}
        </button>
      {/each}

      {#if matchedTickets.length > 0}
        <div class="section-label">Tickets</div>
        {#each matchedTickets as t}
          <button class="row" on:click={() => { dispatch('openTicket', t.id); dispatch('close'); }}>
            <span class="glyph">{t.type === 'bug' ? '●' : '▢'}</span>
            <span class="row-label">{t.title}</span>
            <span class="kbd mono">{t.id}</span>
          </button>
        {/each}
      {:else if query.trim() && searching}
        <div class="section-label">Tickets</div>
        <div class="row hint">Searching…</div>
      {:else if query.trim() && !searching && !parsed}
        <div class="section-label">Tickets</div>
        <div class="row hint">No matches.</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(6,8,11,.5);
    z-index: 60;
    animation: fadeIn .15s ease;
  }
  .palette {
    position: fixed;
    top: 15vh;
    left: 50%;
    transform: translateX(-50%);
    width: min(580px, 92vw);
    background: var(--surface);
    border: 1px solid var(--border-palette);
    border-radius: 14px;
    box-shadow: 0 32px 80px rgba(0,0,0,.5);
    z-index: 61;
    display: flex;
    flex-direction: column;
    animation: popIn .18s ease;
    overflow: hidden;
  }
  .input-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .input-row input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text);
    font-size: 14px;
  }
  .kbd {
    font-family: 'IBM Plex Mono';
    font-size: 10px;
    padding: 2px 6px;
    background: var(--border-subtle);
    color: var(--faint);
    border-radius: 4px;
  }
  .mono { font-family: 'IBM Plex Mono'; }
  .results {
    max-height: 340px;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: 7px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 12.5px;
    width: 100%;
  }
  .row:hover { background: var(--surface-hover); }
  .row.hint { color: var(--faint); cursor: default; font-size: 11.5px; padding-left: 12px; }
  .row.hint:hover { background: transparent; }
  .row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row.nl {
    background: rgba(76,141,255,.08);
  }
  .row.nl:hover { background: rgba(76,141,255,.14); }
  .nl-body { flex: 1; display: flex; flex-direction: column; }
  .nl-title { font-size: 12px; font-weight: 600; color: var(--accent); }
  .nl-sub { font-size: 11px; color: var(--muted); }
  .section-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
    padding: 8px 10px 4px;
  }
  .glyph {
    font-family: 'IBM Plex Mono';
    color: var(--muted);
    font-size: 11px;
    width: 14px;
    text-align: center;
  }
</style>
