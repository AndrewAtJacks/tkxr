<script lang="ts">
  // Slide-in panel that shows live output from an active `claude` CLI run.
  //
  // Multiple concurrent runs are supported via the dropdown in the header;
  // the store keys them by runId. See `claudeRun.ts` for the underlying state.
  //
  // Styling follows the workspace panel conventions used in TicketPanel /
  // SprintPanel — same fixed slide-in, same header/body/footer layout, same
  // buttons. The transcript region uses a monospace font since stream-json
  // output is code-like.

  import { createEventDispatcher, tick } from 'svelte';
  import { activeRunId, cancelRun, claudeRuns, transcriptFor, type ClaudeChunk, type ClaudeRunState } from './claudeRun';
  import { copyToClipboard, showToast } from './clipboard';
  import X from './icons/X.svelte';
  import ChevronDown from './icons/ChevronDown.svelte';

  const dispatch = createEventDispatcher<{ close: void }>();

  // Reactive: pull the active run out of the store. `null` when no run selected.
  $: activeId = $activeRunId;
  $: runs = $claudeRuns;
  $: active = activeId ? runs.get(activeId) ?? null : null;

  // List of runs for the dropdown, most-recent-start first.
  $: allRuns = Array.from(runs.values()).sort((a, b) => b.startedAt - a.startedAt);

  // Rendered lines from the active run's frames. Recomputed whenever the run
  // updates; kept small since we only tail the last ~500 rendered items.
  $: rendered = active ? renderChunks(active.chunks) : [];

  // Auto-scroll the transcript to the tail whenever new lines arrive, but
  // only if the user hasn't scrolled up manually.
  let transcriptEl: HTMLDivElement | null = null;
  let stickyToBottom = true;

  $: if (rendered.length && stickyToBottom) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    scrollToTail();
  }

  async function scrollToTail() {
    await tick();
    if (transcriptEl) transcriptEl.scrollTop = transcriptEl.scrollHeight;
  }

  function onScroll(e: Event) {
    const el = e.currentTarget as HTMLDivElement;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    stickyToBottom = nearBottom;
  }

  let dropdownOpen = false;
  function toggleDropdown() { dropdownOpen = !dropdownOpen; }
  function pickRun(id: string) {
    activeRunId.set(id);
    dropdownOpen = false;
  }

  async function copyTranscript() {
    if (!active) return;
    const text = transcriptFor(active);
    if (!text) {
      showToast('Nothing to copy', 'info');
      return;
    }
    const ok = await copyToClipboard(text);
    showToast(ok ? 'Transcript copied' : 'Copy failed', ok ? 'success' : 'error');
  }

  async function onCancel() {
    if (!active) return;
    await cancelRun(active.runId);
  }

  function statusLabel(s: ClaudeRunState['status']): string {
    switch (s) {
      case 'starting': return 'Starting…';
      case 'running': return 'Running';
      case 'success': return 'Done';
      case 'error': return 'Error';
      case 'cancelled': return 'Cancelled';
    }
  }

  function statusColor(s: ClaudeRunState['status']): string {
    switch (s) {
      case 'starting':
      case 'running': return 'var(--accent, #6ea8ff)';
      case 'success': return '#46c17f';
      case 'error': return '#ff6b6b';
      case 'cancelled': return 'var(--faint)';
    }
  }

  function formatCost(cost?: number): string {
    if (typeof cost !== 'number') return '';
    return `$${cost.toFixed(4)}`;
  }

  function formatDuration(ms?: number): string {
    if (typeof ms !== 'number') return '';
    if (ms < 1000) return `${ms} ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  // Render helper: flatten stream-json chunks into displayable line items
  // (assistant text deltas, tool invocations, system events, stderr, exit).
  interface RenderedLine {
    kind: 'system' | 'assistant' | 'tool' | 'stderr' | 'raw' | 'result';
    text: string;
  }

  function renderChunks(chunks: ClaudeChunk[]): RenderedLine[] {
    const out: RenderedLine[] = [];
    for (const chunk of chunks) {
      const f = chunk.frame;
      if (!f) continue;
      if (chunk.stream === 'stderr') {
        const txt = typeof f.text === 'string' ? f.text : typeof f.line === 'string' ? f.line : '';
        if (txt.trim()) out.push({ kind: 'stderr', text: txt.replace(/\n+$/, '') });
        continue;
      }
      switch (f.type) {
        case 'system': {
          const sub = typeof f.subtype === 'string' ? f.subtype : 'system';
          out.push({ kind: 'system', text: `[system:${sub}]` });
          break;
        }
        case 'assistant': {
          const content = f.message?.content ?? [];
          for (const c of content) {
            if (c.type === 'text' && typeof c.text === 'string') {
              out.push({ kind: 'assistant', text: c.text });
            } else if (c.type === 'tool_use' && typeof c.name === 'string') {
              const inputPreview = c.input !== undefined ? summarizeInput(c.input) : '';
              out.push({ kind: 'tool', text: `${c.name}${inputPreview ? ` ${inputPreview}` : ''}` });
            }
          }
          break;
        }
        case 'user': {
          // Tool results come back as `user` messages with tool_result content.
          const content = f.message?.content ?? [];
          for (const c of content) {
            if (c.type === 'tool_result' && typeof c.text === 'string') {
              out.push({ kind: 'system', text: `[tool_result] ${truncate(c.text, 240)}` });
            }
          }
          break;
        }
        case 'result': {
          if (typeof f.result === 'string' && f.result.trim()) {
            out.push({ kind: 'result', text: f.result });
          }
          break;
        }
        case 'raw': {
          if (typeof f.line === 'string') out.push({ kind: 'raw', text: f.line });
          break;
        }
        default: {
          // Unknown frame type — surface as a compact system marker so the
          // user knows something is happening.
          out.push({ kind: 'system', text: `[${f.type}]` });
        }
      }
    }
    // Only tail the last 500 rendered items to keep the DOM small on long runs.
    return out.length > 500 ? out.slice(-500) : out;
  }

  function summarizeInput(input: unknown): string {
    try {
      const s = JSON.stringify(input);
      return truncate(s, 120);
    } catch {
      return '';
    }
  }
  function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }
</script>

<header class="head">
  <div class="head-left">
    {#if active}
      <span class="dot" style="background:{statusColor(active.status)}"></span>
    {/if}
    {#if allRuns.length > 1}
      <button class="run-picker" on:click={toggleDropdown} title="Switch run">
        <span class="run-label">{active?.label ?? 'Select run'}</span>
        <ChevronDown size={12} />
      </button>
      {#if dropdownOpen}
        <div class="dropdown" role="menu">
          {#each allRuns as r (r.runId)}
            <button
              class="dropdown-item"
              class:active={r.runId === activeId}
              on:click={() => pickRun(r.runId)}
            >
              <span class="dot" style="background:{statusColor(r.status)}"></span>
              <span class="dropdown-label">{r.label}</span>
              <span class="dropdown-id mono">{r.runId.slice(0, 8)}</span>
            </button>
          {/each}
        </div>
      {/if}
    {:else}
      <span class="run-label single">{active?.label ?? 'No active run'}</span>
    {/if}
    {#if active}
      <span class="status" style="color:{statusColor(active.status)}">{statusLabel(active.status)}</span>
    {/if}
  </div>
  <button class="close" on:click={() => dispatch('close')} title="Close"><X size={16} /></button>
</header>

<div class="body">
  {#if !active}
    <div class="empty">No active run. Trigger one from a ticket or sprint panel.</div>
  {:else}
    <div class="meta">
      <span class="mono meta-id">{active.runId}</span>
      {#if active.cwd}
        <span class="meta-cwd" title={active.cwd}>{active.cwd}</span>
      {/if}
    </div>

    <div
      class="transcript"
      bind:this={transcriptEl}
      on:scroll={onScroll}
    >
      {#if rendered.length === 0}
        <div class="waiting">
          <span class="spinner" aria-hidden="true"></span>
          <span>Waiting for output…</span>
        </div>
      {:else}
        {#each rendered as line, i (i)}
          <div class="line line-{line.kind}">{line.text}</div>
        {/each}
        {#if active.status === 'running' || active.status === 'starting'}
          <div class="waiting inline">
            <span class="spinner" aria-hidden="true"></span>
            <span>Streaming…</span>
          </div>
        {/if}
      {/if}
    </div>

    {#if active.status === 'success' || active.status === 'error' || active.status === 'cancelled'}
      <div class="summary">
        {#if typeof active.durationMs === 'number'}
          <span class="pill">Duration {formatDuration(active.durationMs)}</span>
        {/if}
        {#if typeof active.costUsd === 'number'}
          <span class="pill">Cost {formatCost(active.costUsd)}</span>
        {/if}
        {#if typeof active.exitCode === 'number'}
          <span class="pill">Exit {active.exitCode}</span>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<footer class="foot">
  {#if active && (active.status === 'running' || active.status === 'starting')}
    <button class="btn btn-danger" on:click={onCancel}>Cancel</button>
  {:else if active}
    <button class="btn" on:click={copyTranscript}>Copy transcript</button>
  {:else}
    <span class="foot-hint">Runs stream here once started.</span>
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
  .head-left {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .run-picker, .run-label {
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 6px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .run-picker:hover { background: var(--surface-hover); }
  .run-label.single { padding: 0; }
  .status {
    font-size: 11.5px;
    font-weight: 600;
    margin-left: auto;
  }
  .close {
    background: transparent;
    border: none;
    color: var(--muted);
    cursor: pointer;
    padding: 4px;
    border-radius: 5px;
  }
  .close:hover { background: var(--surface-hover); color: var(--text); }

  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 32px rgba(0,0,0,.3);
    min-width: 240px;
    max-width: 320px;
    padding: 4px;
    z-index: 10;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: transparent;
    border: none;
    color: var(--text2);
    font-size: 12px;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
  }
  .dropdown-item:hover { background: var(--surface-hover); color: var(--text); }
  .dropdown-item.active { background: var(--chip); color: var(--text); }
  .dropdown-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dropdown-id { font-size: 10px; color: var(--faint); }

  .body {
    flex: 1;
    overflow: hidden;
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }
  .empty {
    color: var(--faint);
    font-size: 13px;
    text-align: center;
    padding: 32px 8px;
  }
  .meta {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 11px;
    color: var(--faint);
  }
  .meta-id { color: var(--muted); }
  .meta-cwd {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .transcript {
    flex: 1;
    min-height: 120px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .line { margin: 0 0 6px 0; }
  .line-assistant { color: var(--text); }
  .line-result { color: var(--text); font-weight: 600; }
  .line-tool { color: var(--accent, #6ea8ff); }
  .line-system { color: var(--faint); font-size: 11px; }
  .line-stderr { color: #ff6b6b; }
  .line-raw { color: var(--muted); }

  .waiting {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--muted);
    font-size: 12px;
    padding: 12px 4px;
  }
  .waiting.inline { padding: 8px 0 0 0; }
  .spinner {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid var(--border);
    border-top-color: var(--accent, #6ea8ff);
    animation: spin .8s linear infinite;
    flex: none;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .summary {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pill {
    font-size: 11px;
    color: var(--text2);
    background: var(--chip);
    border: 1px solid var(--border);
    padding: 2px 8px;
    border-radius: 5px;
  }

  .foot {
    padding: 12px 18px;
    border-top: 1px solid var(--border-subtle);
    display: flex;
    align-items: center;
    gap: 10px;
    justify-content: space-between;
  }
  .foot-hint {
    font-size: 10.5px;
    color: var(--faint);
  }
  .mono {
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  }
</style>
