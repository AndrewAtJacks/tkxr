<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Sprint } from './stores';
  import { sprintDotColor } from './util';

  // One card in the sprint switcher grid. Extracted because the switcher
  // renders the same card in two sections (in-flight and completed) and
  // Svelte 4 has no snippets to share the markup with.
  export let sprint: Sprint;
  export let active = false;
  export let count = 0;
  /** Percentage of this sprint's tickets that are done. */
  export let pct = 0;
  /** All tickets done but the sprint is still open. */
  export let ready = false;
  export let busy = false;
  export let statuses: Sprint['status'][] = ['planning', 'active', 'completed'];

  const dispatch = createEventDispatcher();

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dispatch('select');
    }
  }
</script>

<!--
  A div, not a button: the lifecycle control below is made of real buttons and
  buttons can't nest. Keyboard activation is wired by hand to match.
-->
<div
  class="sprint-card"
  class:active
  class:done={sprint.status === 'completed'}
  role="button"
  tabindex="0"
  on:click={() => dispatch('select')}
  on:keydown={onKey}
>
  <div class="card-top">
    <span class="dot" style="background:{sprintDotColor(sprint.status)}"></span>
    <span class="s-name">{sprint.name}</span>
    {#if sprint.status === 'completed'}
      <span class="check" title="Completed">✓</span>
    {/if}
  </div>

  {#if sprint.goal}
    <div class="s-goal">{sprint.goal}</div>
  {/if}

  <div class="progress">
    <div class="track"><div class="fill" style="width:{pct}%;background:{sprintDotColor(sprint.status)}"></div></div>
    <span class="mono">{count} ticket{count === 1 ? '' : 's'} · {pct}%</span>
  </div>

  {#if ready}
    <div class="ready">All tickets done — ready to complete</div>
  {/if}

  <!--
    Inline lifecycle control. Status used to be set only from SprintPanel, so
    marking a finished sprint complete meant leaving the picker; this is the
    one screen where every sprint is visible side by side, which is exactly
    where that comparison happens.
  -->
  <div class="lifecycle" role="group" aria-label="Sprint status">
    {#each statuses as st (st)}
      {@const c = sprintDotColor(st)}
      <button
        class="life"
        class:on={sprint.status === st}
        disabled={busy}
        style={sprint.status === st ? `color:${c};background:${c}22;border-color:${c}66` : ''}
        title={`Mark ${st}`}
        on:click|stopPropagation={() => dispatch('status', st)}
      >{st}</button>
    {/each}
  </div>

  <div class="card-foot">
    {#if active}<span class="cur">current</span>{/if}
  </div>
</div>

<style>
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
    transition: border-color .12s, background .12s, opacity .12s;
    min-height: 104px;
  }
  .sprint-card:hover { border-color: var(--border-strong); background: var(--card-hover); }
  .sprint-card:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sprint-card.active { border-color: var(--accent); }
  /* Completed workspaces stay legible but visibly recede. */
  .sprint-card.done { opacity: .62; }
  .sprint-card.done:hover { opacity: 1; }

  .card-top { display: flex; align-items: center; gap: 8px; }
  .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
  .s-name {
    font-size: 14px; font-weight: 600; color: var(--text); flex: 1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .check { font-size: 12px; color: #46c17f; font-weight: 700; }
  .s-goal { font-size: 12px; color: var(--muted); line-height: 1.4; flex: 1; }

  .progress { display: flex; flex-direction: column; gap: 5px; }
  .track { height: 4px; background: var(--surface-3); border-radius: 2px; overflow: hidden; }
  .fill { height: 100%; border-radius: 2px; transition: width .4s ease; }
  .mono { font-family: 'IBM Plex Mono'; font-size: 10.5px; color: var(--faint); }

  .ready { font-size: 11px; font-weight: 600; color: #46c17f; }

  .lifecycle { display: flex; gap: 3px; margin-top: 2px; }
  .life {
    flex: 1;
    padding: 4px 2px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--faint);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: .03em;
    text-transform: uppercase;
    cursor: pointer;
    font-family: inherit;
  }
  .life:hover:not(:disabled) { color: var(--text); border-color: var(--border-strong); }
  .life:disabled { cursor: default; opacity: .6; }

  .card-foot { display: flex; align-items: center; justify-content: flex-end; margin-top: auto; min-height: 12px; }
  .cur { font-size: 10px; font-weight: 600; color: var(--accent); }
</style>
