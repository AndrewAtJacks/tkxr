<script lang="ts">
  export let done = 0;
  export let total = 0;
  $: pct = total > 0 ? Math.round((done / total) * 100) : 0;
  $: fill = pct > 75 ? '#46c17f' : pct > 25 ? '#f2b544' : '#4c8dff';
</script>

<div class="strip">
  <span class="label">Sprint burn</span>
  <div class="track"><div class="fill" style="width:{pct}%;background:{fill}"></div></div>
  <span class="mono">{done}/{total} pts · {pct}%</span>
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 9px 18px;
    background: var(--strip);
    border-bottom: 1px solid var(--border-subtle);
  }
  .label {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: var(--faint);
  }
  .track {
    flex: 1;
    height: 6px;
    background: var(--surface-3);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: 3px;
    transition: width .5s ease;
  }
  .mono {
    font-family: 'IBM Plex Mono';
    font-size: 11px;
    color: var(--muted);
  }
</style>
