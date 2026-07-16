<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let open = false;
  const dispatch = createEventDispatcher();
  function close() { dispatch('close'); }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="overlay" on:click={close} role="presentation"></div>
  <aside class="panel" role="dialog" aria-modal="true">
    <slot />
  </aside>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(6,8,11,.55);
    z-index: 40;
    animation: fadeIn .18s ease;
  }
  .panel {
    position: fixed;
    top: 0; right: 0; bottom: 0;
    width: min(480px, 90vw);
    background: var(--surface);
    border-left: 1px solid var(--border);
    box-shadow: -24px 0 60px rgba(0,0,0,.4);
    z-index: 41;
    display: flex;
    flex-direction: column;
    animation: slideIn .22s cubic-bezier(.2,.7,.3,1);
  }
</style>
