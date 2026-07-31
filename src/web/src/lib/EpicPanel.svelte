<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Epic, Ticket } from './stores';
  import CopyId from './CopyId.svelte';
  import X from './icons/X.svelte';

  export let epic: Epic | null = null;
  export let isCreate = false;
  /** Sprint (workspace) the epic belongs to — new epics default into it. */
  export let sprintId: string | null = null;
  export let tickets: Ticket[] = [];

  const dispatch = createEventDispatcher();

  const EPIC_COLORS = ['#4c8dff', '#6b5bff', '#46c17f', '#f2b544', '#e5687f', '#3fb6c9', '#b57edc'];

  let draft: Partial<Epic> = epic && !isCreate
    ? { ...epic }
    : { name: '', description: '', goal: '', status: 'active', color: EPIC_COLORS[0], sprint: sprintId };

  let saveTimer: number | null = null;

  function setStatus(v: string) {
    draft.status = v as Epic['status'];
    if (!isCreate) schedulePatch({ status: draft.status });
  }

  $: scoped = epic ? tickets.filter(t => t.epic === epic!.id) : [];
  $: totalPts = scoped.reduce((s, t) => s + (t.estimate || 0), 0);
  $: donePts = scoped.filter(t => t.status === 'done').reduce((s, t) => s + (t.estimate || 0), 0);

  function schedulePatch(patch: any) {
    if (!epic || isCreate) return;
    Object.assign(epic, patch);
    epic = { ...epic };
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/epics/${epic!.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) dispatch('reload');
      } catch { /* noop */ }
    }, 300);
  }

  async function commitCreate() {
    if (!draft.name || !draft.name.trim()) return;
    try {
      const body: any = {
        name: draft.name.trim(),
        description: draft.description || undefined,
        goal: draft.goal || undefined,
        status: draft.status,
        color: draft.color,
      };
      if (draft.sprint) body.sprint = draft.sprint;
      const res = await fetch('/api/epics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) return;
      dispatch('reload');
      dispatch('close');
    } catch { /* noop */ }
  }

  async function deleteEpic() {
    if (!epic) return;
    if (!confirm('Delete this epic? Its tickets stay but lose the epic tag.')) return;
    try {
      const res = await fetch(`/api/epics/${epic.id}`, { method: 'DELETE' });
      if (res.ok) {
        dispatch('reload');
        dispatch('close');
      }
    } catch { /* noop */ }
  }
</script>

<header class="head">
  {#if isCreate || !epic}
    <span class="mono id">NEW EPIC</span>
  {:else}
    <span class="id"><CopyId value={epic.id} label="Epic ID" grow /></span>
  {/if}
  <button class="close" on:click={() => dispatch('close')} title="Close"><X size={16} /></button>
</header>

<div class="body">
  <input
    class="ttl"
    placeholder="Epic name"
    bind:value={draft.name}
    on:input={() => !isCreate && schedulePatch({ name: draft.name })}
  />

  <div class="meta">
    <span class="label">Status</span>
    <select
      class="input"
      value={draft.status}
      on:change={(e) => setStatus(e.currentTarget.value)}
    >
      <option value="planning">Planning</option>
      <option value="active">Active</option>
      <option value="completed">Completed</option>
    </select>

    <span class="label">Color</span>
    <div class="colors">
      {#each EPIC_COLORS as c}
        <button
          class="swatch"
          class:sel={draft.color === c}
          style="background:{c}"
          title={c}
          on:click={() => { draft.color = c; if (!isCreate) schedulePatch({ color: c }); }}
        ></button>
      {/each}
    </div>

    <span class="label">Goal</span>
    <input
      class="input"
      placeholder="One-line goal"
      value={draft.goal || ''}
      on:input={(e) => { draft.goal = e.currentTarget.value; if (!isCreate) schedulePatch({ goal: draft.goal }); }}
    />
  </div>

  <div>
    <div class="label" style="margin-bottom:6px">Description</div>
    <textarea
      class="desc"
      placeholder="Describe the epic…"
      bind:value={draft.description}
      on:input={() => !isCreate && schedulePatch({ description: draft.description })}
    ></textarea>
  </div>

  {#if !isCreate && epic}
    <div class="stats">
      <div class="stat"><span class="mono big">{scoped.length}</span><span class="k">tickets</span></div>
      <div class="stat"><span class="mono big">{donePts}/{totalPts}</span><span class="k">points done</span></div>
    </div>
    <div class="ticket-list">
      {#each scoped as t (t.id)}
        <button class="t-row" on:click={() => dispatch('openTicket', t.id)}>
          <span class="mono t-id">{t.id}</span>
          <span class="t-title">{t.title}</span>
          <span class="t-status">{t.status}</span>
        </button>
      {/each}
      {#if scoped.length === 0}
        <div class="empty">No tickets in this epic yet.</div>
      {/if}
    </div>
  {/if}
</div>

<footer class="foot">
  {#if isCreate}
    <button class="btn" on:click={() => dispatch('close')}>Cancel</button>
    <button class="btn btn-primary" on:click={commitCreate}>Create epic</button>
  {:else}
    <button class="btn btn-danger" on:click={deleteEpic}>Delete</button>
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
  .id { font-family: 'IBM Plex Mono'; font-size: 11px; color: var(--faint); flex: 1; }
  .close { background: transparent; border: none; color: var(--muted); cursor: pointer; padding: 4px; border-radius: 5px; }
  .close:hover { background: var(--surface-hover); color: var(--text); }
  .body { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 20px; }
  .ttl {
    border: none; background: transparent; color: var(--text);
    font-size: 19px; font-weight: 600; outline: none; padding: 0; font-family: inherit;
  }
  .meta { display: grid; grid-template-columns: 74px 1fr; align-items: center; gap: 10px 14px; }
  .label {
    font-size: 10.5px; font-weight: 600; letter-spacing: .05em;
    text-transform: uppercase; color: var(--muted);
  }
  .input {
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; font-size: 12.5px; color: var(--text); outline: none; width: 100%; box-sizing: border-box;
  }
  .input:focus { border-color: var(--accent); }
  .colors { display: flex; gap: 6px; flex-wrap: wrap; }
  .swatch {
    width: 22px; height: 22px; border-radius: 6px; border: 2px solid transparent; cursor: pointer; padding: 0;
  }
  .swatch.sel { border-color: var(--text); }
  .desc {
    background: var(--surface-hover); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px; font-size: 12.5px; color: var(--text); outline: none; resize: vertical;
    min-height: 80px; width: 100%; box-sizing: border-box; font-family: inherit;
  }
  .desc:focus { border-color: var(--accent); }
  .stats { display: flex; gap: 12px; }
  .stat {
    flex: 1; background: var(--elevated); border: 1px solid var(--border); border-radius: 10px;
    padding: 12px; display: flex; flex-direction: column; gap: 4px;
  }
  .big { font-size: 18px; font-weight: 600; color: var(--text); }
  .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--faint); }
  .ticket-list { display: flex; flex-direction: column; gap: 4px; }
  .t-row {
    display: flex; align-items: center; gap: 8px; padding: 8px 10px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
    cursor: pointer; text-align: left;
  }
  .t-row:hover { background: var(--surface-hover); }
  .t-id { font-size: 10.5px; color: var(--faint); flex: none; }
  .t-title { flex: 1; font-size: 12.5px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-status { font-size: 10px; text-transform: uppercase; font-weight: 600; color: var(--muted); }
  .empty { font-size: 12px; color: var(--faint); padding: 8px; }
  .foot {
    padding: 12px 18px; border-top: 1px solid var(--border-subtle);
    display: flex; align-items: center; gap: 10px; justify-content: space-between;
  }
  .foot-hint { font-size: 10.5px; color: var(--faint); }
  .btn {
    background: var(--surface); border: 1px solid var(--border); border-radius: 7px;
    color: var(--text2); padding: 7px 14px; font-size: 12px; font-weight: 500; cursor: pointer;
  }
  .btn:hover { background: var(--surface-hover); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
  .btn-danger { color: #ff6b6b; }
</style>
