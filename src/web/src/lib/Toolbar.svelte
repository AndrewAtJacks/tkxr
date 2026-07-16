<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import Search from './icons/Search.svelte';
  import Plus from './icons/Plus.svelte';

  export let title = 'All tickets';
  export let subtitle = '';
  export let shown = 0;
  export let search = '';
  export let typeFilter: 'all' | 'task' | 'bug' = 'all';
  export let sortBy = 'updated';

  const dispatch = createEventDispatcher();

  function chipStyle(active: boolean): string {
    return `padding:5px 10px;border-radius:6px;background:${active ? 'var(--chip)' : 'transparent'};color:${active ? 'var(--text)' : 'var(--muted)'};font-weight:${active ? 600 : 500};font-size:11.5px;border:none;cursor:pointer;`;
  }
</script>

<div class="toolbar">
  <div class="left">
    <div class="title-row">
      <span class="title">{title}</span>
      <span class="mono shown">{shown} shown</span>
    </div>
    {#if subtitle}
      <div class="subtitle">{subtitle}</div>
    {/if}
  </div>

  <div class="right">
    <label class="search">
      <Search size={14} color="var(--muted)" />
      <input
        id="toolbar-search"
        type="text"
        placeholder="Filter tickets…  /"
        value={search}
        on:input={(e) => dispatch('search', e.currentTarget.value)}
      />
    </label>

    <div class="chips">
      <button style={chipStyle(typeFilter === 'all')} on:click={() => dispatch('type', 'all')}>All</button>
      <button style={chipStyle(typeFilter === 'task')} on:click={() => dispatch('type', 'task')}>Tasks</button>
      <button style={chipStyle(typeFilter === 'bug')} on:click={() => dispatch('type', 'bug')}>Bugs</button>
    </div>

    <select class="sort" value={sortBy} on:change={(e) => dispatch('sort', e.currentTarget.value)}>
      <option value="updated">Recently updated</option>
      <option value="created">Newest</option>
      <option value="priority">Priority</option>
      <option value="title">Title A–Z</option>
    </select>

    <button class="new-btn" on:click={() => dispatch('new')}>
      <Plus size={14} />
      <span>New</span>
    </button>
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 18px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg);
    gap: 16px;
    flex-wrap: wrap;
  }
  .left { min-width: 0; }
  .title-row { display: flex; align-items: baseline; gap: 10px; }
  .title { font-size: 16px; font-weight: 600; color: var(--text); }
  .shown { font-size: 10.5px; color: var(--faint); }
  .subtitle {
    font-size: 11.5px;
    color: var(--muted);
    max-width: 340px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 2px;
  }
  .right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .search {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    width: 230px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    transition: border-color .12s, background .12s;
  }
  .search:focus-within {
    border-color: var(--accent);
    background: var(--surface-hover);
  }
  .search input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 12.5px;
    padding: 8px 0;
    color: var(--text);
  }
  .chips {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .sort {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 12.5px;
    padding: 7px 10px;
    border-radius: 8px;
    outline: none;
    cursor: pointer;
  }
  .sort:focus { border-color: var(--accent); background: var(--surface-hover); }
  .new-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 8px;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background .12s;
  }
  .new-btn:hover { background: var(--accent-hover); }
</style>
