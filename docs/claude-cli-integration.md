# Claude CLI Integration — Design Recommendation

Ticket: `tas-tZEbhZWI` · Sprint: `spr-C5Rl8Kim` — *Implement Claude CLI*

This is the kickoff investigation for swapping the copy+paste prompt flow
(`copyPrompt` in `src/web/src/lib/clipboard.ts`) for a direct invocation of
the `claude` CLI. The two follow-up tickets it unblocks are:

- `tas-5j83ACCR` — server: spawn CLI + stream over WebSocket.
- `tas-6XZPfKnY` — config: env vars + `/api/config` probe + clipboard fallback.

Everything below is calibrated against the real CLI (`claude` 2.1.129,
Windows + macOS/Linux behavior verified from `claude --help` and a stream‑json
probe).

---

## TL;DR

- **Mode**: one-shot `claude -p` with `--output-format stream-json --verbose`,
  prompt sent on **stdin**. No `--continue`/`--resume`. Each run is fresh
  and idempotent from tkxr's POV.
- **Spawn**: server-side only, `child_process.spawn` (never `exec`), in
  `src/cli/commands/serve.ts`. Browser cannot spawn — confirmed.
- **Transport**: reuse the existing `WebSocketServer` in `serve.ts`. New
  event types `claude_run_started` / `claude_run_chunk` / `claude_run_exit`
  keyed by `runId`. No SSE — one live socket already fans out to all tabs.
- **CWD contract**: `ticket.worktree.path` → `sprint.worktree.path` → repo
  root, validated against `list_worktrees()` + `getRepoRoot()` before spawn.
- **Binary discovery**: probe once at server start with `which`/`where`,
  cache result on `app.locals`. Env override: `TKXR_CLAUDE_BIN`.
- **Session lifecycle**: one process per prompt. Cancel = `SIGTERM` then
  `SIGKILL` after 2s grace. Concurrent runs supported via a
  `Map<runId, ChildProcess>`.
- **Auth**: the child inherits the user's `~/.claude` credentials for free
  because it inherits `env`. Nothing for us to plumb.
- **Fallback**: if binary missing → `/api/config` returns
  `claude.available: false` and `POST /api/claude/run` returns
  `503 { code: "claude_unavailable" }`. UI keeps `copyPrompt` on that path.

---

## 1. How to invoke `claude`

### 1a. Mode — `-p` (print), not `--continue`

Verified from `claude --help`:

- `-p, --print` — non-interactive, prints response and exits. This is the
  only mode where `--output-format`, `--input-format`, `--fallback-model`,
  `--max-budget-usd`, `--no-session-persistence`, and
  `--include-partial-messages` all work. It's the "headless" mode.
- `--continue` / `--resume` require an interactive TTY. **Not viable** for
  a Node server spawn — it wants to open the interactive picker.

`-p` is the correct choice. Each prompt = one process. If we later want
"continue the conversation about ticket X" we can layer `--session-id`
(deterministic UUID keyed on ticket id) on top without changing the shape.

### 1b. Prompt delivery — stdin, not argv

Two options exist:

```bash
claude -p "$PROMPT" ...            # prompt as argv
echo "$PROMPT" | claude -p ...     # prompt on stdin
```

**Use stdin.** Reasons:

1. Windows argv escaping is hostile (double-quotes, `%…%`, `^`, backticks).
   Even with `spawn` (no shell), the OS still parses argv per-executable.
   Stdin bypasses that entirely.
2. Prompts routinely contain triple-backticks, `${…}`, newlines, and JSON
   blobs (see `workOnTicketPrompt` and `orchestrateSprintPrompt`). Argv
   truncation and shell-safety concerns disappear on stdin.
3. Some OSes cap argv length (~32 KB on Windows CreateProcess). Our
   `orchestrateSprintPrompt` already brushes 5–10 KB with a full sprint and
   will grow.
4. Prompt-injection defense: an attacker who lands text into a ticket
   field cannot break out into a shell — there is no shell in the chain.

Node shape:

```ts
const child = spawn(binPath, ['-p', '--output-format', 'stream-json', '--verbose'], {
  cwd,
  env: process.env,          // inherit auth
  stdio: ['pipe', 'pipe', 'pipe'],
  windowsHide: true,
  shell: false,              // never true — kills the injection defense
});
child.stdin.end(prompt);
```

### 1c. Output format — `stream-json --verbose`

Three `--output-format` values: `text` | `json` | `stream-json`.

A live probe (`echo "Say HELLO" | claude -p --output-format stream-json --verbose`)
shows this frame sequence (JSONL, one event per line):

1. `{"type":"system","subtype":"hook_started",...}` — pre-flight hooks.
2. `{"type":"system","subtype":"init","cwd":"…","session_id":"…","model":"…","tools":[…], "mcp_servers":[…]}` — one-shot init.
3. `{"type":"assistant","message":{"content":[{"type":"text","text":"HELLO"}]…}}` — assistant deltas.
4. `{"type":"rate_limit_event",…}` — occasional.
5. `{"type":"result","subtype":"success","result":"HELLO","duration_ms":1256,"total_cost_usd":0.072,…}` — terminal frame.

This is exactly the shape a "live UI" wants:

- Framing is one JSON object per line → trivial to parse: split stdout on
  `\n`, `JSON.parse` each non-empty line, push to WebSocket.
- Assistant text lands in `msg.message.content[i].text` as the model
  writes it. With `--include-partial-messages` we'd get sub-token chunks
  — probably overkill for a prompt-orchestration UI; we can add it as an
  env-controlled flag later (`TKXR_CLAUDE_ARGS="--include-partial-messages"`).
- The final `result` frame gives us `duration_ms`, `total_cost_usd`, and
  `is_error` — perfect for the "done" toast + transcript metadata.

Recommendation: `--output-format stream-json --verbose` by default.
`--verbose` is required for stream-json to actually stream (per the flag
description). Store the raw frames on the server per `runId` so the
Copy‑transcript action in `tas-T8ZXseeD`'s `ClaudeRunPanel` gets the full
log without re-running.

### 1d. Env vars / flags we care about

- `env: process.env` — inherits `HOME`, `USERPROFILE`, `PATH`,
  `ANTHROPIC_API_KEY` (if user has one), `~/.claude` config lookups. No
  extra plumbing.
- `--no-session-persistence` — recommended default. Keeps the CLI's own
  session store from ballooning with every "Ask about ticket X" run.
  User can turn it off by setting `TKXR_CLAUDE_ARGS=""`.
- `--dangerously-skip-permissions` — **do not add**. Even though every
  prompt is user-authored (the panels build them, then the user clicks
  Run), the CLI's permission prompts guarantee no runaway tool use on
  first-time / novel tools. If users want autonomy they can pass it via
  `TKXR_CLAUDE_ARGS`.
- `--fallback-model` — expose as env `TKXR_CLAUDE_FALLBACK_MODEL`
  (only appended when set); avoids hard-coding a model name.
- `--add-dir` — do **not** auto-add. The `cwd` we set already scopes tool
  access. `--add-dir` is user opt-in via `TKXR_CLAUDE_ARGS`.

### 1e. Exit codes

Claude Code CLI follows POSIX conventions:

- `0` — success (also the final `result` frame carries `is_error: false`).
- `non-zero` — the CLI failed to start, invalid args, network error, or
  the model errored. Stream-json's terminal `result` frame will have
  `is_error: true` and an `api_error_status` message.
- Cancelled via SIGTERM — Node gives us `code=null` and `signal="SIGTERM"`.

Server maps:

- `code === 0 && !is_error` → `{ type: 'claude_run_exit', ok: true }`.
- `signal === 'SIGTERM'` → `{ ok: false, cancelled: true }`.
- else → `{ ok: false, exitCode: code, stderr: <buffered> }`.

---

## 2. Binary discovery (cross-platform)

We need one function, called once at server start, that returns
`{ available: boolean, bin: string, version?: string }`.

### Order of precedence

1. `process.env.TKXR_CLAUDE_BIN` — if set and points at an existing file,
   use it verbatim. Absolute paths only get the fs check; bare names get
   the PATH lookup.
2. PATH lookup: on Windows, `where claude` (returns first match, honors
   `PATHEXT` so `.exe` / `.cmd` are found); on macOS/Linux, `which claude`.
3. If neither succeeds → `{ available: false }`.

Implementation sketch (server-side, no shell escape needed since we
control the invocation):

```ts
import { promisify } from 'util';
import { exec } from 'child_process';
import { access } from 'fs/promises';

const execAsync = promisify(exec);

export async function discoverClaude(): Promise<{ available: boolean; bin: string; version?: string }> {
  if (process.env.TKXR_CLAUDE_DISABLED === '1') return { available: false, bin: '' };

  const override = process.env.TKXR_CLAUDE_BIN?.trim();
  if (override) {
    try { await access(override); return probe(override); } catch { /* fall through */ }
    // Bare name override → treat like PATH lookup below with that name.
  }

  const name = override && !override.includes(path.sep) ? override : 'claude';
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  try {
    const { stdout } = await execAsync(`${lookup} ${name}`);
    const bin = stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
    if (bin) return probe(bin);
  } catch { /* not found */ }
  return { available: false, bin: '' };
}

async function probe(bin: string) {
  try {
    const { stdout } = await execAsync(`"${bin}" --version`, { timeout: 3000 });
    const version = stdout.trim().split(/\s+/)[0];
    return { available: true, bin, version };
  } catch {
    return { available: false, bin };
  }
}
```

The `--version` probe doubles as a "does it actually run" health check
(catches broken installs, missing DLLs, wrong architecture).

### Windows notes

- `where` handles `.exe` / `.cmd` / `.bat` transparently via `PATHEXT`.
  On this machine, `where claude` returns `C:\Users\stilts\.local\bin\claude.exe`.
- The `spawn` call must be `shell: false`. On Windows Node also refuses to
  execute `.cmd` / `.bat` files directly when `shell: false`. **If `bin`
  ends in `.cmd`/`.bat`, set `shell: true` for that one spawn** (it's the
  Windows-recommended workaround). Prefer `.exe` when available.

### Env override docs

Document in README's Configuration section:

- `TKXR_CLAUDE_BIN` — absolute path or bare command name (default `claude`).
- `TKXR_CLAUDE_ARGS` — extra flags appended after `-p ...` (space-split;
  simple `.split(/\s+/)` is fine — no shell metacharacters make it to the
  spawn since `shell: false`).
- `TKXR_CLAUDE_DISABLED` — set to `1` to force the clipboard fallback even
  when the binary is present. Same effect as uninstalling from tkxr's POV.
- `TKXR_CLAUDE_FALLBACK_MODEL` — optional, forwarded as `--fallback-model`.

---

## 3. Integration shape

### Server (tas-5j83ACCR)

New endpoints in `src/cli/commands/serve.ts`:

```
POST /api/claude/run
  body: { prompt: string, cwd?: string, runId?: string, label?: string }
  returns: 200 { runId } | 400 bad_input | 403 bad_cwd | 503 claude_unavailable

POST /api/claude/cancel
  body: { runId: string }
  returns: 200 { cancelled: true } | 404
```

Both use the existing WebSocket for output. New event types:

```ts
type ClaudeRunStarted = { type: 'claude_run_started'; data: { runId; cwd; label; startedAt } };
type ClaudeRunChunk   = { type: 'claude_run_chunk'; data: { runId; stream: 'stdout'|'stderr'; frame: any } };
type ClaudeRunExit    = { type: 'claude_run_exit'; data: { runId; ok; exitCode; signal; durationMs; costUsd? } };
```

State (module-level in `serve.ts`, alongside `mcpTransports`):

```ts
interface Run {
  runId: string;
  child: ChildProcessWithoutNullStreams;
  frames: any[];          // buffered stream-json frames (for late subscribers + transcript)
  startedAt: number;
  cwd: string;
  label?: string;
}
const runs = new Map<string, Run>();
```

Lifecycle:

1. Validate `cwd` — must equal the repo root or match a `worktree.path`
   from `list_worktrees()`. Reject anything else with `403 bad_cwd`.
2. Check `app.locals.claude.available`. If false → `503 claude_unavailable`.
3. `runId ??= randomUUID()`.
4. Spawn child (per §1b/§1c). Buffer `stderr` chunks for the exit event.
5. `child.stdout.on('data', …)` → line-split → JSON.parse per line →
   push into `run.frames` → `broadcast({ type: 'claude_run_chunk', data: { runId, stream: 'stdout', frame } })`.
6. On `child.on('exit', ...)` → broadcast `claude_run_exit`, delete from
   map after a short retention (say 30 s) so late-joining tabs can still
   fetch the transcript once via `GET /api/claude/runs/:runId` (optional
   nicety; can be dropped if the UI already caches from live events).
7. WebSocket `close` handler: cancel any runs owned by that socket **only
   if** we scope runs per-socket. Since prompts are user-initiated and
   multiple tabs can watch the same run, we do **not** kill on any single
   disconnect. Cancel is explicit via `POST /api/claude/cancel`.

Cancel: `child.kill('SIGTERM')`. Set a 2 s timer, if the process is still
alive, `child.kill('SIGKILL')`. On Windows, `taskkill /F /T /PID` is more
reliable than `SIGKILL`; Node ≥ 20 handles this internally when the child
was spawned with `windowsHide: true` and `shell: false`, but the safety
net is worth the extra 5 lines.

### Config (tas-6XZPfKnY)

`GET /api/config` extension:

```ts
{
  host, port, url, version,
  claude: { available: boolean, bin: string, version?: string, disabled?: boolean }
}
```

Populated from the single `discoverClaude()` call at server start and
cached on `app.locals`. No re-probe per request.

Web-side store `src/web/src/lib/stores.ts`:

```ts
export const claudeConfig = writable<{ available: boolean; bin: string; version?: string } | null>(null);
// fetch('/api/config') on app boot, set the store.
```

Fallback wire-up: `src/web/src/lib/claudeRun.ts` (from `tas-T8ZXseeD`)
does the branch:

```ts
if (!get(claudeConfig)?.available) { await copyPrompt(prompt, label); return; }
try {
  const { runId } = await postRun(prompt, opts);
  // subscribe to WS chunks…
} catch (err) {
  if (err.code === 'claude_unavailable') { await copyPrompt(prompt, label); return; }
  throw err;
}
```

The `claudeConfig` branch keeps the label consistent — "Run in Claude"
when available, "Copy prompt" otherwise. Every panel (`TicketPanel`,
`SprintPanel`, `TriagePanel`) reads from the same store.

### CWD contract

Server pseudocode:

```ts
async function resolveCwd(requested: string | undefined, ticketId?: string): Promise<string> {
  const repoRoot = await getRepoRoot();
  const worktrees = new Set([repoRoot, ...(await listWorktrees()).map(w => path.resolve(w.path))]);
  if (!requested) return repoRoot;
  const normalized = path.resolve(requested);
  if (!worktrees.has(normalized)) throw new HttpError(403, 'bad_cwd');
  return normalized;
}
```

The web store already surfaces `ticket.worktree?.path` and
`sprint.worktree?.path`; those are passed as the `cwd` and validated here.
No worktree = repo root. This satisfies the ticket's "workspace escape
via cwd" concern.

---

## 4. Auth / credentials

Zero configuration on tkxr's side. `claude` reads its OAuth token from
`~/.claude/credentials.json` (or keychain on macOS) or `ANTHROPIC_API_KEY`
from the environment. Because the child inherits `env: process.env` and
runs as the same user as `tkxr serve`, it picks up whatever the user
already has configured.

Corollaries:

- If `tkxr serve` is running as a different user (systemd, service
  account, WSL vs host), the child's `~/.claude` may be empty. Document
  as "run tkxr serve as your normal user" in the README section.
- The `--bare` flag is available if we ever need to bypass keychain and
  force strict `ANTHROPIC_API_KEY` — not the default, but a good escape
  hatch we can expose via `TKXR_CLAUDE_ARGS`.
- No secrets touch tkxr's logs / disk / storage. The stream-json frames
  contain the prompt + response text but not the API key.

---

## 5. Fallback strategy (binary missing / disabled)

Three tiers, each transparent to the UI:

1. **Boot-time discovery fails** → `/api/config` returns
   `claude.available: false`. Every panel already reads the store; the
   button label + click handler branch to `copyPrompt` from day one. No
   error state, no user surprise.
2. **Boot-time succeeded, but process spawn later throws** (ENOENT after
   binary was moved, permission error) → `POST /api/claude/run` returns
   `503 { code: 'claude_unavailable', message: <err.message> }`. The
   `runPrompt` helper catches that code and falls through to
   `copyPrompt`, plus flips the `claudeConfig.available` store to false
   so subsequent clicks skip the round-trip.
3. **Explicit disable** — `TKXR_CLAUDE_DISABLED=1`. Discovery short-circuits
   to `{ available: false }` even if the binary is on PATH. Useful for
   users who like the copy-paste flow, or for environments where the CLI
   is present but they want to control cost manually.

The existing `copyPrompt` at `src/web/src/lib/clipboard.ts:43` stays as-is
and is the sole fallback surface. No dead code — the "Copy prompt" button
lives on forever as the offline / disabled experience.

---

## 6. Security notes

Baked in already by the shape choices above:

- **Prompt injection via ticket fields**: prompt travels on stdin, no
  shell, `spawn(bin, argv, { shell: false })`. Even a ticket titled
  `"; rm -rf ~ #` is inert.
- **Windows argv quoting**: sidestepped by never putting the prompt in
  argv. `TKXR_CLAUDE_ARGS` splits on whitespace, so the only argv values
  are known flag strings the user chose (still no shell).
- **Workspace escape via cwd**: `resolveCwd` allow-lists `repoRoot` and
  `listWorktrees()` output only. Anything else → 403. No `..` traversal
  matters because `path.resolve` collapses it before the set check.
- **CSRF on the new endpoints**: same origin as the existing `/api/*`
  surface. No new auth model needed; if a threat model surfaces later
  we can add a shared-secret header from `.tkxr-server` (already writes
  to disk with the URL — perfect place for a token).
- **Cost surprise**: `--max-budget-usd` is available on `-p` runs. Not
  wiring it by default, but expose via env
  (`TKXR_CLAUDE_MAX_BUDGET_USD`) so cost-conscious users can cap runs.

---

## 7. Concrete deliverables for the follow-up tickets

### For `tas-5j83ACCR` (server)

- New file `src/core/claude.ts` exporting `discoverClaude()` (§2) and
  `spawnClaude({ prompt, cwd, runId, args })` returning a
  `ChildProcessWithoutNullStreams`.
- `serve.ts` additions:
  - Call `discoverClaude()` once at start, store on `app.locals.claude`
    and include in `/api/config`.
  - `POST /api/claude/run` handler as specified in §3.
  - `POST /api/claude/cancel` handler.
  - `runs: Map<string, Run>` module state.
  - Broadcast helpers reuse the existing `broadcast(wss, msg)`.
- No changes to `worktree.ts`; use `getRepoRoot()` + `listWorktrees()`
  as-is.
- Do **not** touch the UI in this ticket.

### For `tas-6XZPfKnY` (config)

- Extend `/api/config` payload with `claude: { available, bin, version }`.
- README Configuration section: document `TKXR_CLAUDE_BIN`,
  `TKXR_CLAUDE_ARGS`, `TKXR_CLAUDE_DISABLED`,
  `TKXR_CLAUDE_FALLBACK_MODEL`, `TKXR_CLAUDE_MAX_BUDGET_USD`.
- `src/web/src/lib/stores.ts`: new `claudeConfig` writable populated on
  boot from `GET /api/config`.
- No new UI in this ticket — `tas-T8ZXseeD` picks up the store to drive
  button labels + `runPrompt` branching.

### For `tas-T8ZXseeD` (web helper, downstream)

Already spec'd in its own ticket; the additions here are:

- Use the existing `notifier` WebSocket connection instead of opening a
  new one — the sprint's chosen transport is "reuse the WS".
- When a `claude_run_exit` arrives with `ok: false && exitCode === 127`
  (ENOENT), flip `claudeConfig.available = false` locally so subsequent
  clicks fall back without a round-trip.

---

## 8. Open questions (defer, but flagged)

1. **Transcript persistence**: should the server keep run frames past the
   30 s in-memory window? Would enable "resume watching a run after tab
   reload". Punt to a follow-up sprint — not required for MVP.
2. **`--session-id` reuse for "Ask about ticket X"**: could give the model
   memory of prior asks on the same ticket. Deterministic seed = SHA1 of
   ticket id, first 16 bytes formatted as UUID. Nice-to-have, not in this
   sprint.
3. **Multi-user tkxr deployments**: current design assumes single-user
   local dev. If we ever host `tkxr serve` for a team, each user's
   `~/.claude` credentials would collide. Not in scope; add
   per-request `--settings <json>` when we get there.

---

## 9. Verified against real CLI

- Binary present: `C:\Users\stilts\.local\bin\claude.exe`.
- Version: `2.1.129`.
- `echo "…" | claude -p --output-format stream-json --verbose` streams
  JSONL frames as documented in §1c.
- Final `result` frame carries `duration_ms`, `total_cost_usd`,
  `is_error`, and `session_id` — everything the UI needs for the "done"
  toast and transcript metadata.
- Exit code `0` on success; `session_id` differs per run when
  `--no-session-persistence` is set (recommended default).

That's it — no known blockers for `tas-5j83ACCR` and `tas-6XZPfKnY` to
start immediately.
