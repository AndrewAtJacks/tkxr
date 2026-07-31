<script lang="ts">
  // Click-to-copy chip for identifiers (ticket / sprint / user ids) and short
  // text. Exists because the board previously had no copy affordance at all:
  // selecting an id and hitting Ctrl+C was swallowed by the global `c`
  // hotkey (see routes/+page.svelte onGlobalKey), so ids were effectively
  // uncopyable. Reuses the shared clipboard + toast helpers.
  import { copyToClipboard, showToast } from './clipboard';
  import Check from './icons/Check.svelte';
  import Copy from './icons/Copy.svelte';

  export let value: string;
  /** Used in the toast + a11y label, e.g. "Ticket ID copied". */
  export let label = 'ID';
  /** Stretch to fill the flex row it sits in (matches the old `.id { flex: 1 }`). */
  export let grow = false;
  export let size = 11;

  let copied = false;
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy(e: MouseEvent | KeyboardEvent) {
    // Panels/cards open on click — don't let the copy press bubble into them.
    e.stopPropagation();
    const ok = await copyToClipboard(value);
    showToast(ok ? `${label} copied` : 'Copy failed', ok ? 'success' : 'error');
    if (!ok) return;
    copied = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => { copied = false; }, 1200);
  }
</script>

<button
  type="button"
  class="copy-id"
  class:grow
  class:copied
  title={`Copy ${label.toLowerCase()}: ${value}`}
  aria-label={`Copy ${label.toLowerCase()}`}
  on:click={copy}
>
  <span class="val">{value}</span>
  <span class="ico" aria-hidden="true">
    {#if copied}<Check size={size} color="#46c17f" />{:else}<Copy size={size} />{/if}
  </span>
</button>

<style>
  .copy-id {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 2px 5px;
    margin: -2px -5px;
    background: none;
    border: 1px solid transparent;
    border-radius: 5px;
    font: inherit;
    font-family: 'IBM Plex Mono';
    color: inherit;
    cursor: pointer;
    text-align: left;
    transition: background .12s, border-color .12s, color .12s;
  }
  .copy-id.grow { flex: 1; }
  .copy-id:hover {
    background: var(--surface-hover);
    border-color: var(--border-2);
    color: var(--text);
  }
  .copy-id:focus-visible {
    outline: none;
    border-color: var(--accent);
  }
  .copy-id.copied { color: #46c17f; }
  .val {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ico {
    display: inline-flex;
    flex: 0 0 auto;
    opacity: 0;
    transition: opacity .12s;
  }
  .copy-id:hover .ico,
  .copy-id:focus-visible .ico,
  .copy-id.copied .ico { opacity: 1; }
</style>
