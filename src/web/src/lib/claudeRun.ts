// Shared helper + Svelte store for driving the `claude` CLI from the UI.
//
// Design notes (see docs/claude-cli-integration.md §7 for full context):
//
// - Runs are keyed by `runId` (UUID). Multiple concurrent runs are supported
//   by keeping a `Writable<Map<runId, ClaudeRunState>>`.
// - The helper opens a dedicated WebSocket back to the same origin, subscribes
//   to the three server-broadcast event types (`claude_run_started` /
//   `claude_run_chunk` / `claude_run_exit`), and folds them into the store.
//   Using a dedicated socket keeps this module self-contained — downstream
//   panels only import `runPrompt` / `cancelRun` / `claudeRuns` and don't need
//   any wiring from the shell.
// - Availability fallback: if `claudeConfig.available === false` at click
//   time, we short-circuit to `copyPrompt`. If the POST returns 503
//   `claude_unavailable`, we flip the store to `available: false` locally so
//   subsequent clicks skip the round-trip, then fall back to `copyPrompt`.
//   The intent matches docs §5.
// - Transcripts assembled from stream-json frames land in
//   `ClaudeRunState.transcript`, extracted lazily by the panel/callers.

import { get, writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { claudeConfig } from './stores';
import { claudeAvailable } from './settings';
import { copyPrompt, showToast } from './clipboard';

// ---------------------------------------------------------------------------
// Types

export type ClaudeRunStatus = 'starting' | 'running' | 'success' | 'error' | 'cancelled';

/** stream-json frame — the CLI's JSONL event shape. */
export interface ClaudeFrame {
  type: string;
  // stream-json frames carry these fields on various subtypes; kept loose so
  // the panel can render whatever the CLI emits without a full type schema.
  subtype?: string;
  message?: {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
    role?: string;
  };
  content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  text?: string;
  line?: string;
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface ClaudeChunk {
  stream: 'stdout' | 'stderr';
  frame: ClaudeFrame;
  at: number;
}

export interface ClaudeRunState {
  runId: string;
  label: string;
  cwd: string;
  status: ClaudeRunStatus;
  chunks: ClaudeChunk[];
  startedAt: number;
  exitedAt?: number;
  exitCode?: number | null;
  signal?: string | null;
  isError?: boolean;
  cancelled?: boolean;
  costUsd?: number;
  durationMs?: number;
  /** Non-fatal / spawn error captured before the server accepted the run. */
  clientError?: string;
}

// Server event shapes — match `broadcast()` payloads in serve.ts.
interface ClaudeRunStartedEvent {
  type: 'claude_run_started';
  data: { runId: string; cwd: string; label?: string; startedAt: number };
}
interface ClaudeRunChunkEvent {
  type: 'claude_run_chunk';
  data: { runId: string; stream: 'stdout' | 'stderr'; frame: ClaudeFrame };
}
interface ClaudeRunExitEvent {
  type: 'claude_run_exit';
  data: {
    runId: string;
    ok: boolean;
    exitCode: number | null;
    signal: string | null;
    durationMs: number;
    costUsd?: number;
    isError?: boolean;
    cancelled?: boolean;
    stderr?: string;
  };
}

type ClaudeRunEvent = ClaudeRunStartedEvent | ClaudeRunChunkEvent | ClaudeRunExitEvent;

// ---------------------------------------------------------------------------
// Store

/** Keyed by runId. Consumers subscribe with `$claudeRuns`. */
export const claudeRuns: Writable<Map<string, ClaudeRunState>> = writable(new Map());

/**
 * Set of runIds we've initiated from this tab. The panel uses this to decide
 * which runs to auto-focus on start (avoiding stealing focus for runs kicked
 * off by another tab), while still keeping remote runs visible in the dropdown.
 */
export const ownedRunIds: Writable<Set<string>> = writable(new Set());

/**
 * The runId the ClaudeRunPanel is actively displaying. `null` means the panel
 * is closed. Written by both the panel (user picks a run from the dropdown)
 * and `runPrompt` (open on first successful start).
 */
export const activeRunId: Writable<string | null> = writable(null);

// ---------------------------------------------------------------------------
// WebSocket subscription

let ws: WebSocket | null = null;
let wsReconnectTimer: number | null = null;

function ensureSocket() {
  if (!browser) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}`);
    ws.onmessage = (ev: MessageEvent) => {
      let msg: unknown;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      const t = (msg as { type?: string }).type;
      if (t === 'claude_run_started' || t === 'claude_run_chunk' || t === 'claude_run_exit') {
        handleEvent(msg as ClaudeRunEvent);
      }
    };
    ws.onclose = () => {
      ws = null;
      if (wsReconnectTimer !== null) window.clearTimeout(wsReconnectTimer);
      wsReconnectTimer = window.setTimeout(() => {
        wsReconnectTimer = null;
        ensureSocket();
      }, 3000);
    };
    ws.onerror = () => {
      try { ws?.close(); } catch { /* noop */ }
    };
  } catch {
    // Autoreconnect handled by close/timer path above.
  }
}

function handleEvent(ev: ClaudeRunEvent) {
  if (ev.type === 'claude_run_started') {
    const d = ev.data;
    claudeRuns.update(map => {
      const next = new Map(map);
      const existing = next.get(d.runId);
      next.set(d.runId, {
        runId: d.runId,
        label: existing?.label ?? d.label ?? 'Claude run',
        cwd: d.cwd,
        status: 'running',
        chunks: existing?.chunks ?? [],
        startedAt: d.startedAt,
      });
      return next;
    });
    return;
  }
  if (ev.type === 'claude_run_chunk') {
    const d = ev.data;
    claudeRuns.update(map => {
      const cur = map.get(d.runId);
      if (!cur) return map;
      const next = new Map(map);
      next.set(d.runId, {
        ...cur,
        chunks: [...cur.chunks, { stream: d.stream, frame: d.frame, at: Date.now() }],
      });
      return next;
    });
    return;
  }
  if (ev.type === 'claude_run_exit') {
    const d = ev.data;
    claudeRuns.update(map => {
      const cur = map.get(d.runId);
      if (!cur) return map;
      const next = new Map(map);
      const status: ClaudeRunStatus = d.cancelled
        ? 'cancelled'
        : d.ok
          ? 'success'
          : 'error';
      next.set(d.runId, {
        ...cur,
        status,
        exitedAt: Date.now(),
        exitCode: d.exitCode,
        signal: d.signal,
        isError: d.isError,
        cancelled: d.cancelled,
        costUsd: d.costUsd,
        durationMs: d.durationMs,
      });
      return next;
    });

    // Toast is only surfaced for locally-initiated runs to avoid noise from
    // parallel tabs / other operators.
    const owned = get(ownedRunIds).has(d.runId);
    if (owned) {
      const cur = get(claudeRuns).get(d.runId);
      const label = cur?.label ?? 'Claude run';
      if (d.cancelled) {
        showToast(`${label}: cancelled`, 'info');
      } else if (d.ok) {
        const cost = typeof d.costUsd === 'number' ? ` ($${d.costUsd.toFixed(3)})` : '';
        showToast(`${label}: done${cost}`, 'success');
      } else {
        showToast(`${label}: failed${typeof d.exitCode === 'number' ? ` (exit ${d.exitCode})` : ''}`, 'error', 4000);
      }
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Public API

export interface RunPromptOptions {
  cwd?: string;
  label?: string;
}

export interface RunPromptResult {
  runId?: string;
  /** `false` when we fell back to clipboard (unavailable / 503). */
  spawned: boolean;
}

/**
 * Fire a prompt at the claude CLI over the server. When the CLI is not
 * available, falls back to `copyPrompt` transparently and toasts.
 *
 * Callers don't need to await this — the returned promise resolves once the
 * server acknowledges the spawn (or the clipboard write completes). All
 * ongoing output flows through the `claudeRuns` store.
 */
export async function runPrompt(prompt: string, opts: RunPromptOptions = {}): Promise<RunPromptResult> {
  const cfg = get(claudeConfig);
  const label = opts.label ?? 'Claude run';

  // Availability short-circuit (docs §5 tier 1). `claudeAvailable` folds in the
  // user-facing "force copy-paste" setting from settings.ts — when the user
  // has flipped that toggle we skip the CLI entirely, even if the server has
  // the binary.
  if (!get(claudeAvailable)) {
    await copyPrompt(prompt, `${label}: prompt copied — paste into Claude Code`);
    return { spawned: false };
  }
  // Retain the `cfg` guard for TS narrowing / defense: `claudeAvailable` being
  // true implies `cfg.available` is true, but the compiler doesn't know that.
  void cfg;

  // Generate the runId client-side so we can wire up the "owned" set + open
  // the panel eagerly, before the server round-trip completes.
  const runId = generateRunId();

  ensureSocket();

  // Seed a starting-state entry so the panel has something to show even before
  // the server's `claude_run_started` broadcast arrives.
  claudeRuns.update(map => {
    const next = new Map(map);
    next.set(runId, {
      runId,
      label,
      cwd: opts.cwd ?? '',
      status: 'starting',
      chunks: [],
      startedAt: Date.now(),
    });
    return next;
  });
  ownedRunIds.update(s => new Set(s).add(runId));

  // Open the panel on the first started run in this tab.
  if (get(activeRunId) === null) activeRunId.set(runId);

  let res: Response;
  try {
    res = await fetch('/api/claude/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, cwd: opts.cwd, runId, label }),
    });
  } catch (err) {
    return failLocal(runId, cfg, prompt, label, err instanceof Error ? err.message : String(err), /*flipStore*/ false);
  }

  if (res.status === 503) {
    // Server says the binary is unavailable — flip the store and fall back
    // (docs §5 tier 2).
    claudeConfig.update(c => (c ? { ...c, available: false } : { available: false, bin: '' }));
    return failLocal(runId, cfg, prompt, label, 'claude CLI unavailable on server', /*flipStore*/ true);
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({} as { error?: { message?: string } }));
    const message = err?.error?.message ?? `HTTP ${res.status}`;
    // Not a fallback candidate — leave availability alone, mark run as error.
    claudeRuns.update(map => {
      const cur = map.get(runId);
      if (!cur) return map;
      const next = new Map(map);
      next.set(runId, { ...cur, status: 'error', clientError: message });
      return next;
    });
    showToast(`${label}: ${message}`, 'error', 4000);
    return { runId, spawned: false };
  }

  // Success — the server will broadcast `claude_run_started` shortly.
  showToast(`${label}: running`, 'info');
  return { runId, spawned: true };
}

function failLocal(
  runId: string,
  _cfg: unknown,
  prompt: string,
  label: string,
  reason: string,
  flipStore: boolean,
): Promise<RunPromptResult> {
  // Drop the seeded starting-state entry — we didn't actually spawn.
  claudeRuns.update(map => {
    const next = new Map(map);
    next.delete(runId);
    return next;
  });
  ownedRunIds.update(s => {
    const next = new Set(s);
    next.delete(runId);
    return next;
  });
  activeRunId.update(cur => (cur === runId ? null : cur));

  if (flipStore) {
    // Availability already flipped by caller. Show a note that we fell back.
    showToast(`${label}: claude unavailable — copied prompt to clipboard`, 'info', 3200);
  }
  return copyPrompt(prompt, `${label}: prompt copied — paste into Claude Code (${reason})`)
    .then(() => ({ spawned: false }));
}

/** Ask the server to SIGTERM the run. The exit event flips status locally. */
export async function cancelRun(runId: string): Promise<void> {
  try {
    await fetch('/api/claude/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
  } catch {
    // If the request fails, the exit event will still arrive if/when the
    // process ends naturally. Nothing else to do here.
  }
}

/**
 * Concatenate assistant text + tool-call summaries from a run's frames into a
 * plain-text transcript suitable for clipboard copy.
 */
export function transcriptFor(run: ClaudeRunState): string {
  const parts: string[] = [];
  for (const chunk of run.chunks) {
    const f = chunk.frame;
    if (!f) continue;
    if (chunk.stream === 'stderr') {
      const txt = typeof f.text === 'string' ? f.text : f.line;
      if (txt) parts.push(`[stderr] ${txt}`);
      continue;
    }
    if (f.type === 'assistant' && f.message?.content) {
      for (const c of f.message.content) {
        if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
        else if (c.type === 'tool_use' && typeof c.name === 'string') parts.push(`[tool: ${c.name}]`);
      }
    } else if (f.type === 'result' && typeof f.result === 'string') {
      // Terminal frame's result is the final answer — often duplicates the
      // last assistant text. Only append if we haven't already captured it.
      if (!parts.length || parts[parts.length - 1] !== f.result) parts.push(f.result);
    } else if (f.type === 'raw' && typeof f.line === 'string') {
      parts.push(f.line);
    }
  }
  return parts.join('\n\n').trim();
}

// ---------------------------------------------------------------------------
// Utilities

function generateRunId(): string {
  if (browser && typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback UUID-ish for non-crypto environments (SSR paths, older browsers).
  const rnd = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `${rnd()}${rnd()}-${rnd()}-${rnd()}-${rnd()}-${rnd()}${rnd()}${rnd()}`;
}
