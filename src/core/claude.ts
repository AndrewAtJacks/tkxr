// Claude CLI discovery + config surface + server-side runner primitives.
//
// This module owns the "does the user have a working `claude` CLI on their
// machine" probe. It is called once at server boot from `src/cli/commands/serve.ts`
// and the result is cached on `app.locals.claude`. Downstream tickets
// (tas-5j83ACCR — server spawn, tas-T8ZXseeD / G7GkoInt / 3Rto4I82 / 1xjZ4qLb —
// panel wiring) consume that cached result rather than re-probing.
//
// Design reference: docs/claude-cli-integration.md §2 + §7 (discovery), §1 + §3
// (spawn / stream-json shape).
//
// Env vars honored:
//   TKXR_CLAUDE_BIN              — absolute path OR bare command name.
//                                  Absolute paths get a direct fs check.
//                                  Bare names go through where/which.
//                                  Default: `claude`.
//   TKXR_CLAUDE_ARGS             — extra flags forwarded to spawn by
//                                  tas-5j83ACCR. Not consumed here, but
//                                  read once so it's parsed + validated at
//                                  boot for consistent behavior.
//   TKXR_CLAUDE_DISABLED         — `1` / `true` short-circuits discovery to
//                                  `{ available: false, disabled: true }`
//                                  so users can force the clipboard fallback
//                                  even when the binary is present.
//   TKXR_CLAUDE_FALLBACK_MODEL   — appended by tas-5j83ACCR as
//                                  `--fallback-model <value>` when set.
//   TKXR_CLAUDE_MAX_BUDGET_USD   — appended by tas-5j83ACCR as
//                                  `--max-budget-usd <value>` when set.

import { promisify } from 'util';
import { exec, spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { access } from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export interface ClaudeConfig {
  /** True only when the binary is discoverable AND `--version` succeeded. */
  available: boolean;
  /** Absolute path (or bare name that resolved via PATH). Empty string when unavailable. */
  bin: string;
  /** Version string reported by `<bin> --version`, when the probe succeeded. */
  version?: string;
  /** True when TKXR_CLAUDE_DISABLED forced the fallback path. */
  disabled?: boolean;
  /** Extra args (from TKXR_CLAUDE_ARGS) that the spawner ticket will forward. */
  extraArgs?: string[];
  /** Optional --fallback-model value from TKXR_CLAUDE_FALLBACK_MODEL. */
  fallbackModel?: string;
  /** Optional --max-budget-usd value from TKXR_CLAUDE_MAX_BUDGET_USD. */
  maxBudgetUsd?: string;
}

/**
 * Parse TKXR_CLAUDE_ARGS. Simple whitespace split — the spawn call in
 * tas-5j83ACCR uses `shell: false` so no shell metacharacters can reach
 * the OS process boundary. Empty / undefined → [].
 *
 * Exported so `src/cli/commands/serve.ts` can also parse the env value at
 * spawn time when `app.locals.claude.extraArgs` was not pre-populated.
 */
export function parseExtraArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

function isDisabled(): boolean {
  const v = process.env.TKXR_CLAUDE_DISABLED;
  if (!v) return false;
  const norm = v.trim().toLowerCase();
  return norm === '1' || norm === 'true' || norm === 'yes';
}

/**
 * Health-probe a candidate binary by running `<bin> --version`. This doubles
 * as a "does it actually run" check so we catch broken installs, wrong
 * architecture, missing DLLs, etc. up front rather than blowing up on the
 * first spawn.
 *
 * Not exported: consumers should call `discoverClaude()` which orchestrates
 * env override + PATH lookup + probe.
 */
async function probeVersion(bin: string): Promise<{ available: boolean; bin: string; version?: string }> {
  try {
    // Quote the bin path to survive spaces on Windows (e.g. Program Files).
    // exec runs through cmd/sh but the only user-controlled input here is the
    // env-provided path — which we just fs-verified or resolved via where/which.
    const { stdout } = await execAsync(`"${bin}" --version`, { timeout: 3000 });
    const version = stdout.trim().split(/\s+/)[0] || undefined;
    return { available: true, bin, version };
  } catch {
    // Binary exists on disk but doesn't run cleanly. Treat as unavailable so
    // the UI stays on the clipboard fallback rather than throwing on first use.
    return { available: false, bin };
  }
}

/**
 * Discover the user's `claude` binary. Runs once at server boot.
 *
 * Precedence (matches docs/claude-cli-integration.md §2):
 *   1. TKXR_CLAUDE_DISABLED short-circuits to `{ available: false, disabled: true }`.
 *   2. TKXR_CLAUDE_BIN absolute path → direct fs check + probe.
 *   3. TKXR_CLAUDE_BIN bare name  → PATH lookup (where/which) + probe.
 *   4. Default `claude`           → PATH lookup + probe.
 *   5. Nothing works              → `{ available: false, bin: '' }`.
 *
 * Never throws. Failure modes always resolve to `available: false` so the
 * caller can trust the shape.
 */
export async function discoverClaude(): Promise<ClaudeConfig> {
  const extraArgs = parseExtraArgs(process.env.TKXR_CLAUDE_ARGS);
  const fallbackModel = process.env.TKXR_CLAUDE_FALLBACK_MODEL?.trim() || undefined;
  const maxBudgetUsd = process.env.TKXR_CLAUDE_MAX_BUDGET_USD?.trim() || undefined;

  if (isDisabled()) {
    return { available: false, bin: '', disabled: true, extraArgs, fallbackModel, maxBudgetUsd };
  }

  const override = process.env.TKXR_CLAUDE_BIN?.trim();
  const withMeta = (base: { available: boolean; bin: string; version?: string }): ClaudeConfig => ({
    ...base,
    extraArgs,
    fallbackModel,
    maxBudgetUsd,
  });

  // Absolute path override → try direct probe, no PATH lookup.
  if (override && (path.isAbsolute(override) || override.includes(path.sep))) {
    try {
      await access(override);
      return withMeta(await probeVersion(override));
    } catch {
      // Absolute-ish path pointed nowhere. Fall through and try PATH with the
      // basename so users who set TKXR_CLAUDE_BIN to a stale path still work
      // if the CLI is otherwise on their PATH.
    }
  }

  // PATH lookup. Use the override's bare name if provided, else the default.
  const name = override && !override.includes(path.sep) ? override : (override ? path.basename(override) : 'claude');
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execAsync(`${lookup} ${name}`, { timeout: 3000 });
    const bin = stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (bin) return withMeta(await probeVersion(bin));
  } catch {
    // Not on PATH.
  }
  return withMeta({ available: false, bin: '' });
}

/**
 * Redact internal fields (extraArgs / fallbackModel / maxBudgetUsd) for the
 * `GET /api/config` response. The web UI only needs to know "can we run" and
 * which binary + version to show in the tooltip. The spawner reads the full
 * struct off `app.locals.claude` directly.
 */
export function toPublicConfig(c: ClaudeConfig): { available: boolean; bin: string; version?: string; disabled?: boolean } {
  const out: { available: boolean; bin: string; version?: string; disabled?: boolean } = {
    available: c.available,
    bin: c.bin,
  };
  if (c.version) out.version = c.version;
  if (c.disabled) out.disabled = c.disabled;
  return out;
}

// -------------------- Server-side runner (tas-5j83ACCR) --------------------
//
// Spawn/cancel primitives consumed by `src/cli/commands/serve.ts`. Kept in this
// module so all Claude-CLI knowledge lives in one place — argv shape, stdin
// framing, cross-platform kill semantics.

export interface SpawnClaudeOptions {
  prompt: string;
  cwd: string;
  bin: string;
  /** Extra flags appended after `-p --output-format stream-json --verbose`. Space-split. */
  extraArgs?: string[];
}

/**
 * In-memory record of a live `claude` run. Held in a `Map<runId, ClaudeRun>`
 * inside the serve command so late-joining WebSocket subscribers can replay
 * frames and cancel can look up the child by id.
 */
export interface ClaudeRun {
  runId: string;
  child: ChildProcessWithoutNullStreams;
  /** Buffered stream-json frames (for late subscribers / transcript). */
  frames: any[];
  /** Buffered stderr chunks, emitted verbatim on exit for failure diagnostics. */
  stderrBuf: string[];
  startedAt: number;
  cwd: string;
  label?: string;
  /** Partial-line carry for the JSONL parser (stdout may not deliver whole lines). */
  stdoutBuf: string;
}

/**
 * Spawn `claude` in one-shot mode with the prompt piped on stdin.
 * Returns the child immediately. Caller wires stdout/stderr/exit listeners.
 *
 * Never sets `shell: true` (defense against prompt-injection via ticket fields).
 * Exception: on Windows, `.cmd` / `.bat` binaries require `shell: true` — Node's
 * `spawn` won't execute them directly with `shell: false`. We opt in only for that
 * narrow case; `.exe` (the normal install shape) still uses `shell: false`.
 */
export function spawnClaude(opts: SpawnClaudeOptions): ChildProcessWithoutNullStreams {
  const { prompt, cwd, bin, extraArgs = [] } = opts;

  const baseArgs = ['-p', '--output-format', 'stream-json', '--verbose'];
  // Default to no session persistence — see docs §1d.
  if (!extraArgs.includes('--no-session-persistence')) {
    baseArgs.push('--no-session-persistence');
  }
  const fallbackModel = process.env.TKXR_CLAUDE_FALLBACK_MODEL?.trim();
  if (fallbackModel && !extraArgs.some(a => a === '--fallback-model')) {
    baseArgs.push('--fallback-model', fallbackModel);
  }
  const maxBudget = process.env.TKXR_CLAUDE_MAX_BUDGET_USD?.trim();
  if (maxBudget && !extraArgs.some(a => a === '--max-budget-usd')) {
    baseArgs.push('--max-budget-usd', maxBudget);
  }

  const argv = [...baseArgs, ...extraArgs];

  const lower = bin.toLowerCase();
  const isWindowsScript =
    process.platform === 'win32' && (lower.endsWith('.cmd') || lower.endsWith('.bat'));

  const child = spawn(bin, argv, {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: isWindowsScript,
  }) as ChildProcessWithoutNullStreams;

  // Write the prompt to stdin. Close stdin so the CLI knows there's no more input.
  child.stdin.write(prompt);
  child.stdin.end();

  return child;
}

/**
 * Cross-platform "make sure this child is dead". SIGTERM first, then SIGKILL after
 * a grace period. On Windows, Node's kill() forwards to TerminateProcess for SIGKILL.
 */
export function killWithGrace(
  child: ChildProcessWithoutNullStreams,
  graceMs = 2000,
): void {
  if (child.killed || child.exitCode !== null) return;
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
  const timer = setTimeout(() => {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }, graceMs);
  // Don't hold the event loop open on this timer.
  timer.unref?.();
  child.once('exit', () => clearTimeout(timer));
}
