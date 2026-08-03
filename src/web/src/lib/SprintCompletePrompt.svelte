<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fly } from 'svelte/transition';
  import type { Sprint } from './stores';
  import X from './icons/X.svelte';
  import Check from './icons/Check.svelte';

  // Fires on the board once every ticket in the active workspace is done and
  // the sprint itself is still open. Deliberately a corner card rather than a
  // modal — finishing the last ticket shouldn't seize the screen, and the board
  // underneath is what the user is looking at.
  export let sprint: Sprint;
  export let done = 0;
  export let total = 0;
  /** Epics under this sprint that aren't `completed` yet; they roll up too. */
  export let openEpics = 0;
  export let busy = false;

  const dispatch = createEventDispatcher();
</script>

<div class="prompt" role="dialog" aria-label="Complete sprint" transition:fly={{ y: 16, duration: 180 }}>
  <button class="dismiss" title="Dismiss" on:click={() => dispatch('dismiss')}><X size={14} /></button>

  <div class="head">
    <span class="badge"><Check size={13} /></span>
    <div>
      <div class="title">Complete sprint?</div>
      <div class="sub">All {total} ticket{total === 1 ? '' : 's'} in <strong>{sprint.name}</strong> are done.</div>
    </div>
  </div>

  <div class="meta mono">{done}/{total} done{#if openEpics > 0} · {openEpics} epic{openEpics === 1 ? '' : 's'} will be marked completed{/if}</div>

  <div class="actions">
    <button class="ghost" on:click={() => dispatch('dismiss')}>Not yet</button>
    <button class="primary" disabled={busy} on:click={() => dispatch('complete')}>
      {busy ? 'Completing…' : 'Complete sprint'}
    </button>
  </div>
</div>

<style>
  .prompt {
    position: fixed;
    right: 20px;
    bottom: 20px;
    z-index: 60;
    width: 320px;
    background: var(--elevated);
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 12px 34px rgba(0, 0, 0, .34);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dismiss {
    position: absolute;
    top: 8px;
    right: 8px;
    background: transparent;
    border: none;
    color: var(--faint);
    cursor: pointer;
    padding: 3px;
    border-radius: 5px;
    line-height: 0;
  }
  .dismiss:hover { color: var(--text); background: var(--surface-hover); }

  .head { display: flex; align-items: flex-start; gap: 10px; padding-right: 18px; }
  .badge {
    width: 24px; height: 24px;
    flex: none;
    border-radius: 7px;
    background: rgba(70, 193, 127, .16);
    color: #46c17f;
    display: flex; align-items: center; justify-content: center;
  }
  .title { font-size: 13.5px; font-weight: 600; color: var(--text); }
  .sub { font-size: 12px; color: var(--muted); line-height: 1.45; margin-top: 2px; }
  .sub strong { color: var(--text2); font-weight: 600; }
  .meta { font-family: 'IBM Plex Mono'; font-size: 10.5px; color: var(--faint); }

  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .ghost {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 7px;
    color: var(--muted);
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .ghost:hover { color: var(--text); border-color: var(--border-strong); }
  .primary {
    background: #46c17f;
    border: none;
    border-radius: 7px;
    color: #0b0e12;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .primary:disabled { opacity: .55; cursor: default; }
</style>
