<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte';
  import type { Ticket, User } from './stores';
  import { avatarColorFor, AVATAR_PALETTE, initials, normalizeTicket, STATUS_COLOR, STATUS_LABEL, STATUS_ORDER } from './util';
  import { onTicketEvent } from './ticketEvents';
  import X from './icons/X.svelte';

  export let user: User | null = null;
  export let isCreate = false;
  // Legacy prop retained for backwards compat; assigned tickets are now
  // fetched directly via `GET /api/tickets?assignee=<id>` so the panel is
  // correct once the main store is paged (see tas-z-8q_Ljc).
  export let tickets: Ticket[] = [];
  // Keep the prop referenced so svelte-check doesn't flag it as unused; the
  // parent still binds it during the concurrent tas-RYc3-yIM refactor.
  $: void tickets;

  const dispatch = createEventDispatcher();

  let draft: Partial<User> = user && !isCreate
    ? { ...user }
    : {
        username: '',
        displayName: '',
        email: '',
        color: AVATAR_PALETTE[0],
      };
  let saveTimer: number | null = null;

  // Dedicated assignee slice — fetched on mount and refetched on ticket_*
  // WebSocket events while the panel is open.
  let assigned: Ticket[] = [];
  let assignedAbort: AbortController | null = null;

  $: statusCounts = STATUS_ORDER.map(s => ({ s, n: assigned.filter(t => t.status === s).length }));

  async function fetchAssigned() {
    if (!user) return;
    if (assignedAbort) assignedAbort.abort();
    const ac = new AbortController();
    assignedAbort = ac;
    try {
      const res = await fetch(`/api/tickets?assignee=${encodeURIComponent(user.id)}&limit=200`, { signal: ac.signal });
      if (!res.ok) return;
      const j = await res.json();
      const items: any[] = Array.isArray(j) ? j : (j.items || []);
      assigned = items.map(normalizeTicket);
    } catch (err) {
      if ((err as any)?.name === 'AbortError') return;
    } finally {
      if (assignedAbort === ac) assignedAbort = null;
    }
  }

  onMount(() => {
    if (!isCreate && user) fetchAssigned();
    const off = onTicketEvent(() => { if (!isCreate && user) fetchAssigned(); });
    return () => {
      off();
      if (assignedAbort) assignedAbort.abort();
    };
  });

  function schedulePatch(patch: any) {
    if (!user || isCreate) return;
    Object.assign(user, patch);
    user = { ...user };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/${user!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) dispatch('reload');
      } catch { /* noop */ }
    }, 300);
  }

  async function commitCreate() {
    if (!draft.username || !draft.displayName) return;
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) return;
      dispatch('reload');
      dispatch('close');
    } catch { /* noop */ }
  }

  async function deleteUser() {
    if (!user) return;
    if (!confirm('Remove this person?')) return;
    try {
      const res = await fetch(`/api/users/${user.id}`, { method: 'DELETE' });
      if (res.ok) {
        dispatch('reload');
        dispatch('close');
      }
    } catch { /* noop */ }
  }
</script>

<header class="head">
  <span class="avatar" style="background:{draft.color || avatarColorFor({ id: 'x' })}">{initials(draft.displayName || '?')}</span>
  <span class="mono id">{isCreate ? 'NEW PERSON' : user?.id}</span>
  <button class="close" on:click={() => dispatch('close')}><X size={16} /></button>
</header>

<div class="body">
  <div class="grid">
    <span class="label">Name</span>
    <input class="input" placeholder="Full name" bind:value={draft.displayName} on:input={() => !isCreate && schedulePatch({ displayName: draft.displayName })} />
    <span class="label">Username</span>
    <input class="input" placeholder="handle" bind:value={draft.username} on:input={() => !isCreate && schedulePatch({ username: draft.username })} />
    <span class="label">Email</span>
    <input class="input" placeholder="name@example" bind:value={draft.email} on:input={() => !isCreate && schedulePatch({ email: draft.email })} />
    <span class="label">Color</span>
    <div class="swatches">
      {#each AVATAR_PALETTE as c}
        <button
          class="swatch"
          style="background:{c};{draft.color === c ? 'box-shadow:0 0 0 2px var(--text)' : ''}"
          on:click={() => { draft.color = c; if (!isCreate) schedulePatch({ color: c }); }}
        ></button>
      {/each}
    </div>
  </div>

  <div>
    <div class="section-head">Workload</div>
    <div class="workload">
      {#each statusCounts as { s, n }}
        <div class="stat">
          <div class="stat-n" style="color:{STATUS_COLOR[s]}">{n}</div>
          <div class="stat-l">{STATUS_LABEL[s]}</div>
        </div>
      {/each}
    </div>
  </div>

  {#if !isCreate && user}
    <div>
      <div class="section-head">Assigned · {assigned.length}</div>
      {#if assigned.length === 0}
        <div class="empty">Nothing assigned right now.</div>
      {:else}
        <div class="items">
          {#each assigned as t}
            <button class="item" on:click={() => dispatch('openTicket', t.id)}>
              <span class="s-dot" style="background:{STATUS_COLOR[t.status]}"></span>
              <span class="mono id">{t.id}</span>
              <span class="item-title">{t.title}</span>
              <span class="status-label" style="color:{STATUS_COLOR[t.status]}">{STATUS_LABEL[t.status]}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<footer class="foot">
  {#if isCreate}
    <button class="btn" on:click={() => dispatch('close')}>Cancel</button>
    <button class="btn btn-primary" on:click={commitCreate}>Add person</button>
  {:else}
    <button class="btn btn-danger" on:click={deleteUser}>Remove person</button>
    <span class="foot-hint">Edits save automatically</span>
  {/if}
</footer>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .avatar {
    width: 28px; height: 28px;
    border-radius: 7px;
    display: flex; align-items: center; justify-content: center;
    font-size: 11px;
    font-weight: 600;
    color: #0b0e12;
  }
  .id { font-family: 'IBM Plex Mono'; font-size: 11px; color: var(--faint); flex: 1; }
  .close { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 5px; }
  .close:hover { background: var(--surface-hover); color: var(--text); }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .grid {
    display: grid;
    grid-template-columns: 84px 1fr;
    align-items: center;
    gap: 10px 14px;
  }
  .label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .05em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .swatches {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .swatch {
    width: 22px; height: 22px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    transition: box-shadow .12s;
  }
  .section-head {
    font-size: 12px;
    font-weight: 600;
    color: var(--text2);
    margin-bottom: 8px;
  }
  .workload {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 8px;
  }
  .stat {
    background: var(--elevated);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    text-align: center;
  }
  .stat-n { font-size: 18px; font-weight: 700; }
  .stat-l {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: .04em;
    font-weight: 600;
    margin-top: 2px;
  }
  .empty { color: var(--faint); font-size: 12px; padding: 8px 0; }
  .items { display: flex; flex-direction: column; gap: 4px; }
  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: 12px;
    width: 100%;
  }
  .item:hover { background: var(--surface); }
  .s-dot { width: 8px; height: 8px; border-radius: 3px; flex: none; }
  .item .id { flex: 0 0 auto; }
  .item-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status-label { font-size: 10.5px; font-weight: 600; }
  .foot {
    padding: 12px 18px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }
  .foot-hint { font-size: 10.5px; color: var(--faint); }
</style>
