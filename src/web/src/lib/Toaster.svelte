<script lang="ts">
  import { toasts } from './clipboard';
</script>

<div class="toaster">
  {#each $toasts as t (t.id)}
    <div class="toast" class:success={t.kind === 'success'} class:error={t.kind === 'error'}>{t.text}</div>
  {/each}
</div>

<style>
  .toaster {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 100;
    pointer-events: none;
  }
  .toast {
    background: var(--card);
    color: var(--text);
    border: 1px solid var(--border);
    padding: 8px 14px;
    border-radius: 8px;
    font-size: 12.5px;
    box-shadow: 0 8px 20px rgba(0,0,0,.3);
    animation: fadeIn .18s ease;
    pointer-events: auto;
  }
  .toast.success { border-color: rgba(70,193,127,.5); }
  .toast.error { border-color: rgba(255,107,107,.5); }
</style>
