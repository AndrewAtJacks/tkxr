<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import { sprintStore, type Sprint } from './stores';
  import { sprintDotColor } from './util';
  import { onTicketEvent } from './ticketEvents';
  import Plus from './icons/Plus.svelte';

  // The sprint switcher is the "workspace picker" — a sprint now frames the
  // entire board, so choosing/creating one is a distinct full-screen step
  // rather than an inline filter chip. Shown as a gate when no workspace is
  // active, and on demand via the sidebar "Switch" button.
  export let sprints: Sprint[] = [];
  export let activeSprint: string = '';
  /** When true there is no active workspace yet — copy nudges toward creating one. */
  export let gate = false;

  /** Id of the "Unsorted" pseudo-workspace (tickets with no sprint). */
  const UNSORTED = 'none';

  const dispatch = createEventDispatcher();

  let creating = false;
  let name = '';
  let goal = '';
  let busy = false;

  // Per-sprint totals come from `/api/tickets/summary`'s project-wide
  // `bySprint` bucket. The old client-side count read the parent's paged
  // ticket slice, so every card under-reported once paging kicked in.
  let bySprint: Record<string, number> = {};
  let countsAbort: AbortController | null = null;
  async function fetchCounts() {
    if (countsAbort) countsAbort.abort();
    const ac = new AbortController();
    countsAbort = ac;
    try {
      const res = await fetch('/api/tickets/summary', { signal: ac.signal });
      if (!res.ok) return;
      const j = await res.json();
      bySprint = j.bySprint || {};
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
    } finally {
      if (countsAbort === ac) countsAbort = null;
    }
  }
  onMount(() => {
    fetchCounts();
    const off = onTicketEvent(() => fetchCounts());
    return () => {
      off();
      if (countsAbort) countsAbort.abort();
    };
  });

  $: unsortedCount = bySprint[UNSORTED] || 0;
  // Unsorted is only worth showing when it holds something — or when the user
  // is already standing in it. Without this card, tickets with no sprint (all
  // pre-existing data, plus anything orphaned by deleting a sprint) would have
  // no route back into the UI.
  $: showUnsorted = unsortedCount > 0 || activeSprint === UNSORTED;
  $: ordered = [...sprints].sort((a, b) => {
    // Active workspaces first, then planning, then completed; newest within a bucket.
    const rank = (s: Sprint) => (s.status === 'active' ? 0 : s.status === 'planning' ? 1 : 2);
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  function pick(id: string) {
    dispatch('select', id);
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    busy = true;
    try {
      const res = await fetch('/api/sprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, goal: goal.trim() || undefined, status: 'active' }),
      });
      if (res.ok) {
        const created = await res.json();
        name = '';
        goal = '';
        creating = false;
        // Push the new sprint into the store *before* selecting it. The
        // parent's "workspace still exists?" guard runs on the next flush; if
        // `sprintStore` doesn't hold the sprint yet it resets `activeSprint`
        // and bounces us straight back to the gate. `reload` is async and
        // fire-and-forget, so it can't be relied on to land first.
        sprintStore.update((list: Sprint[]) =>
          list.some(s => s.id === created.id) ? list : [...list, created]);
        dispatch('reload');
        // Enter the freshly-created workspace immediately.
        dispatch('select', created.id);
      }
    } catch { /* noop */ }
    finally { busy = false; }
  }
</script>

<div class="switcher">
  <div class="inner">
    <header class="head">
      <div>
        <h1>{gate ? 'Choose a sprint to begin' : 'Switch sprint'}</h1>
        <p class="sub">
          {#if gate}
            A sprint frames your whole workspace. Pick one to open the board, or create a new sprint to get started.
          {:else}
            Sprints wrap the entire board. Switch to another workspace, or spin up a new one.
          {/if}
        </p>
      </div>
      {#if !gate}
        <button class="ghost" on:click={() => dispatch('close')}>Close</button>
      {/if}
    </header>

    <div class="grid">
      {#if showUnsorted}
        <button class="sprint-card" class:active={activeSprint === UNSORTED} on:click={() => pick(UNSORTED)}>
          <div class="card-top">
            <span class="dot" style="background:var(--surface-3)"></span>
            <span class="s-name">Unsorted</span>
            <span class="s-status">no sprint</span>
          </div>
          <div class="s-goal">Tickets that don't belong to any sprint yet.</div>
          <div class="card-foot">
            <span class="mono">{unsortedCount} tickets</span>
            {#if activeSprint === UNSORTED}<span class="cur">current</span>{/if}
          </div>
        </button>
      {/if}
      {#each ordered as s (s.id)}
        <button class="sprint-card" class:active={s.id === activeSprint} on:click={() => pick(s.id)}>
          <div class="card-top">
            <span class="dot" style="background:{sprintDotColor(s.status)}"></span>
            <span class="s-name">{s.name}</span>
            <span class="s-status">{s.status}</span>
          </div>
          {#if s.goal}
            <div class="s-goal">{s.goal}</div>
          {/if}
          <div class="card-foot">
            <span class="mono">{bySprint[s.id] || 0} tickets</span>
            {#if s.id === activeSprint}<span class="cur">current</span>{/if}
          </div>
        </button>
      {/each}

      {#if creating}
        <div class="sprint-card creating">
          <input class="input" placeholder="Sprint name" bind:value={name} on:keydown={(e) => e.key === 'Enter' && create()} />
          <input class="input" placeholder="Goal (optional)" bind:value={goal} on:keydown={(e) => e.key === 'Enter' && create()} />
          <div class="create-actions">
            <button class="ghost" on:click={() => { creating = false; name = ''; goal = ''; }}>Cancel</button>
            <button class="primary" disabled={!name.trim() || busy} on:click={create}>Create + open</button>
          </div>
        </div>
      {:else}
        <button class="sprint-card new" on:click={() => (creating = true)}>
          <Plus size={18} />
          <span>New sprint</span>
        </button>
      {/if}
    </div>

    {#if sprints.length === 0 && !creating}
      <div class="empty-hint">
        No sprints yet — create your first to open the board.
        {#if showUnsorted}Existing tickets stay reachable under <strong>Unsorted</strong> until you file them into one.{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .switcher {
    height: 100%;
    overflow-y: auto;
    display: flex;
    justify-content: center;
    padding: 48px 24px;
  }
  .inner { width: 100%; max-width: 820px; }
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 28px;
  }
  h1 { font-size: 22px; font-weight: 600; letter-spacing: -.01em; margin: 0; color: var(--text); }
  .sub { font-size: 13px; color: var(--muted); margin: 8px 0 0; max-width: 560px; line-height: 1.5; }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 14px;
  }
  .sprint-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    text-align: left;
    background: var(--card);
    border: 1px solid var(--border-2);
    border-radius: 12px;
    padding: 16px;
    cursor: pointer;
    transition: border-color .12s, background .12s;
    min-height: 104px;
  }
  .sprint-card:hover { border-color: var(--border-strong); background: var(--card-hover); }
  .sprint-card.active { border-color: var(--accent); }
  .card-top { display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  .s-name { font-size: 14px; font-weight: 600; color: var(--text); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-status {
    font-size: 9.5px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em;
    color: var(--faint);
  }
  .s-goal { font-size: 12px; color: var(--muted); line-height: 1.4; flex: 1; }
  .card-foot { display: flex; align-items: center; justify-content: space-between; margin-top: auto; }
  .card-foot .mono { font-family: 'IBM Plex Mono'; font-size: 10.5px; color: var(--faint); }
  .cur { font-size: 10px; font-weight: 600; color: var(--accent); }
  .sprint-card.new {
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 8px;
    border-style: dashed;
    color: var(--muted);
  }
  .sprint-card.new:hover { color: var(--text); }
  .sprint-card.new span { font-size: 12.5px; font-weight: 500; }
  .sprint-card.creating { cursor: default; gap: 8px; }
  .input {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 12.5px;
    color: var(--text);
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }
  .input:focus { border-color: var(--accent); }
  .create-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 2px; }
  .ghost {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .ghost:hover { color: var(--text); border-color: var(--border-strong); }
  .primary {
    background: var(--accent);
    border: none;
    border-radius: 7px;
    color: #fff;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled { opacity: .5; cursor: default; }
  .empty-hint { margin-top: 20px; font-size: 12.5px; color: var(--faint); text-align: center; }
</style>
