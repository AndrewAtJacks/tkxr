# Changelog

## [2.1.4] - 2026-07-16
### Changed
- Patch version bumped automatically during build.

## [2.1.3] - 2026-07-16
### Changed
- Patch version bumped automatically during build.

## [2.1.2] - 2026-07-16

### Added
- **Sidebar settings popover with "Disable Claude CLI" toggle.** Gear
  button next to the theme toggle in the sidebar footer opens a small
  popover with a persistent switch. When flipped on, every prompt-
  launching action (Work on this, Plan with Claude, Commit with Claude,
  triage, custom asks) skips the server-spawned CLI and copies the
  prompt to the clipboard instead — the paste-into-terminal fallback
  that users have found more reliable than the CLI runs. State is
  persisted to `localStorage` under `tkxr-settings`.
- **`claudeAvailable` derived store** (`src/web/src/lib/settings.ts`).
  Folds server-reported CLI availability with the user's disable
  setting. Panels (`TicketPanel`, `SprintPanel`, `TriagePanel`) and
  `runPrompt` all read this store, so button labels and behavior stay
  in sync live when the user flips the toggle.

## [2.1.1] - 2026-07-16

### Fixed
- **Worktree endpoints in installed/global tkxr.** `tkxr serve` chdir's into
  its `dist/` at boot for static-asset resolution. When tkxr was installed
  outside the target repo (global install / linked package) the fallback
  landed in the install dir's `dist/` — outside any git repo — and every
  worktree/git endpoint (`/api/worktrees`, `/api/tickets/:id/worktree`,
  `/api/sprints/:id/worktree`, `/api/git/remote`, `/api/tickets/:id/git`,
  `/api/sprints/:id/git`) failed with "Not a git repository" even though
  the user launched from a valid repo root. The MCP-over-HTTP worktree
  tools failed the same way. Now `serve` captures the original cwd before
  chdir and threads it into `isGitRepo`, `listWorktrees`, `createWorktree`,
  `createSprintWorktree`, `removeWorktree`, `getRemoteInfo`, `getRepoRoot`,
  and `resolveClaudeCwd`. `ToolContext` gained a `repoCwd?: string` field
  so the MCP handlers get the same fix.

## [2.1.0] - 2026-07-16

### Added
- **Server-paged tickets.** `GET /api/tickets` returns a
  `{ items, nextCursor, total }` envelope when any of
  `limit | cursor | q | sprint | assignee | type | status | sortBy` is
  present, so a large repo no longer ships its full ticket store to the
  browser on every load. Default `limit` is 50, hard cap 200; cursors are
  opaque base64url of `sortValue|id`. Requests without any paging params
  still return the legacy `Ticket[]` shape, so the CLI `list` command
  and any external scripts that hard-code the pre-paging response keep
  working unchanged.
- **`GET /api/tickets/summary`.** Aggregate counts for sidebar badges,
  triage pill, and Board column badges — returns
  `{ counts: { backlog, progress, review, blocked, done, total }, triage: { unassignedOpen, criticalOpen, backlogCount }, byStatus }`.
  Cheap single-pass over `getAllTickets()`; sidebar coalesces bursts of
  `ticket_*` events into one refetch 500ms after the last one.
- **Infinite scroll (List view).** `IntersectionObserver` on a sentinel
  row inside `.list` fires `pagedTickets.fetchNextPage()` when within one
  viewport (`rootMargin: 400px`) of visibility. Guards against parallel
  in-flight page loads and de-dupes items by id, so rapid scroll +
  WebSocket `ticket_created` racing a page fetch cannot double-render a
  row.
- **Per-column "Load more" (Board view).** Each of the five status
  columns owns its own `createPagedTicketStore()` with a fixed `limit: 25`
  and a "Load more (N left)" button that extends only that column. Column
  badges show the server-side total so counts stay honest even when the
  column only holds a slice.
- **Server-side toolbar search.** The toolbar search input debounces
  ~200ms and calls `resetAndFetch({ q, ... })` on the active store, with
  an `AbortController` on every fetch so a slow first page cannot
  overwrite the results of a newer query. Changing sprint / assignee /
  type / status / sort chips also triggers `resetAndFetch` and scrolls
  back to page 1.
- **`pagedTickets` singleton + `createPagedTicketStore()` factory.** New
  in `src/web/src/lib/stores.ts`; exposes reactive `items`, `nextCursor`,
  `total`, `loading` stores plus `resetAndFetch(query)`, `fetchNextPage()`
  and `applyEvent(evt)` for WS-driven mutations.
- **`ticketEvents.ts` shared WS bus.** Single lazily-created WebSocket
  connection fanned out to all panels that need `ticket_*` events
  (Sidebar summary, SprintPanel, UserPanel, CommandPalette, TicketPanel
  dep picker). Torn down when the last subscriber unmounts, so closed
  panels impose zero ambient traffic. Replaces the pattern of each panel
  opening its own duplicate socket.

### Changed
- `+page.svelte` routes `ticket_created` / `ticket_updated` /
  `ticket_deleted` WS events to `pagedTickets.applyEvent(...)` instead of
  refetching the full ticket list. New rows insert in the correct sort
  position on page 1 or are ignored past the cursor to avoid
  double-counting on the next fetch; updates mutate in place; deletes
  drop the row from every loaded page.

### Fixed
- **Claude CLI runs no longer stall on approval prompts.** The headless
  runner now passes `--permission-mode <mode>` (defaulting to
  `bypassPermissions`) so tool-use never waits for an interactive
  approval that the web UI can't answer. New `TKXR_CLAUDE_PERMISSION_MODE`
  env var picks the mode; `plan` is refused (no non-interactive escape).
  `TKXR_CLAUDE_ARGS` is scrubbed of `--permission-mode plan` at both
  discovery and spawn time. Every prompt now leads with a headless-mode
  execution directive telling the model not to enter plan mode or ask
  for approval. ClaudeRunPanel detects permission-request frames and
  renders an explicit banner instead of stalling silently (bug-I30c9l0_).

### Added
- **"Commit with Claude" on sprint panel.** Analogue to the ticket-level
  action — runs a prompt scoped to the sprint worktree that stages any
  uncommitted work and lands a Conventional Commit. Handles three cases:
  integration commits tagged with the sprint id, ticket-specific commits
  tagged with the ticket id, and `chore(merge): <ticket-id>` merges for
  unmerged ticket branches.
- **BranchInsights component** on ticket + sprint panels. Read-only
  branch state so commits landing in per-ticket/per-sprint worktrees
  are no longer invisible from the primary VSCode window. Shows base,
  HEAD, commits ahead of base (with short sha + relative time), diff
  shortstat, dirty flag, `origin/<branch>` ahead/behind, and
  GitHub/GitLab/Bitbucket **Open branch** + **Compare vs base** links.
  Auto-refreshes on `claude_run_exit` WS events.
- **"Push + open PR" primary action.** Shells out to `gh` server-side —
  ticket PRs target the sprint branch (its natural base), sprint PRs
  target the repo default. Draft PRs by default; existing OPEN PRs on
  the same head are reused so re-clicks push new commits without
  duplicating. Structured error codes (`gh_missing`,
  `gh_not_authenticated`, `base_not_on_remote`, `push_failed`,
  `pr_lookup_failed`, `pr_create_failed`) map to HTTP status so the UI
  can render actionable messages.
- **`gh` capability probed at server boot**, surfaced via `/api/config.gh`
  so the UI can gate the PR button on availability + auth. Env var
  `TKXR_GH_DISABLED=1` opts out.
- **REST:** `GET /api/git/remote`, `GET /api/tickets/:id/git`,
  `GET /api/sprints/:id/git`, `POST /api/tickets/:id/pr`,
  `POST /api/sprints/:id/pr`.

### Docs
- README: new **Search + infinite scroll** subsection under Web UI, new
  **Paged tickets** and **Ticket summary** subsections under REST API,
  and `/api/tickets/summary` added to the endpoint list.
- README + `docs/claude-cli-integration.md`: document
  `TKXR_CLAUDE_PERMISSION_MODE`, and supersede the old
  "do not add --dangerously-skip-permissions" guidance with the new
  permission-mode-first policy.

## [2.0.2] - 2026-07-16

### Fixed
- `updateTicket` (assign, sprint set, and any patch without a `status`
  field) round-tripped legacy `todo` rows back through the WS broadcast,
  which the board silently dropped since `todo` is no longer a valid
  column. The read-side mapping in `getAllTickets` now also runs on the
  write path, so the row is migrated in place on the next update.
- Sidebar rows with long sprint or user names pushed the count badge and
  filter button off the right edge (the filter icon was unreachable even
  on hover). Added `min-width: 0` to `.row-main` so the label ellipsis
  engages under sibling pressure.

All notable changes to this project will be documented in this file.

## [2.0.1] - 2026-07-16

### Fixed
- MCP over HTTP: each session gets its own `McpServer` instance instead
  of sharing one across all `StreamableHTTPServerTransport` connections.
  Fixes tangled request-handler state when multiple MCP clients connect
  concurrently.

### Packaging
- Ship `CHANGELOG.md` in the published tarball (added to `files`).
- Explicitly list `LICENSE` in `files` (was auto-included).

## [2.0.0] - 2026-07-16

First semver-major release. Kills the modal-based UI, ships MCP-over-HTTP
alongside the stdio bin, and makes git worktrees a first-class primitive
for both tickets and sprints so agent orchestration can fan out cleanly.

### Breaking Changes
- **TicketStatus enum widened** from `{ todo, progress, done }` to
  `{ backlog, progress, review, blocked, done }`. Legacy `todo` values
  transparently migrate to `backlog` on read, but any external tooling
  that hard-codes the old three-state enum (custom scripts, dashboards,
  webhook consumers) will need to widen its own type. `STATUS_ORDER` on
  the web side is now `['backlog', 'progress', 'review', 'blocked', 'done']`.
- **UI fully rewritten.** The modal-heavy 1.x UI is gone. New layout is
  a persistent left sidebar + right-side workspace panel with a Kanban
  board across all five statuses, command palette (⌘K), always-visible
  filters + toolbar, sprint burn strip, and IBM Plex + CSS-token theming
  (dark default, light override). Any bookmarks / muscle memory targeting
  the old modals will not carry over.
- **MCP server split.** The stdio bin (`tkxr-mcp`) is unchanged in
  invocation, but the underlying tool implementations moved into a shared
  module also mounted at `/mcp` by `tkxr serve`. If you imported internals
  from `src/mcp/server.ts`, the entry points have moved.
- **Default ticket estimate is now `1`** (was unset). New tickets created
  through CLI/MCP/REST without an explicit `--estimate` will report `1`
  where they previously reported `null`.

### Added
- **MCP over HTTP.** `tkxr serve` now mounts the full MCP surface at
  `/mcp` in addition to the WebSocket + REST API, so agents can attach
  to a running dev server instead of spawning their own stdio process.
  New tools: `get_ticket`, `search_tickets`, `list_worktrees`,
  `create_worktree`, `remove_worktree`, `create_sprint_worktree`,
  `remove_sprint_worktree`, plus `agent_guide` and server instructions
  so agents can bootstrap themselves.
- **Per-ticket and per-sprint worktrees.** Both entities gain an optional
  `worktree { path, branch, createdAt }` field. `tkxr worktree create/remove
  <id>` dispatches on the id prefix (`spr-` vs `tas-`/`bug-`). Ticket
  worktrees created inside a sprint that has its own worktree auto-base
  their branch off the sprint branch, enabling a fan-out / merge-back
  orchestration where a parent agent spawns per-ticket sub-agents and
  merges each ticket branch into the sprint feature branch. Ticket
  worktrees auto-close on move to `done`; sprint worktrees auto-close on
  move to `completed`. Both are best-effort and skip on dirty tree.
- **Ticket dependencies.** New `Ticket.dependsOn` array of ticket ids.
  `get_ticket` returns resolved `dependencies` + `blockedBy` (unmet
  non-done deps). `list_tickets` includes `dependsOn` + `blockedBy` per
  row so orchestrators can build a full dep graph in a single call.
  Edit ops: `dependsOn` / `addDependencies` / `removeDependencies` /
  `clearDependencies`. TicketPanel gains a Depends-on chip section
  (green for done, red for missing) with type-ahead add and click-to-jump.
- **Prompt-for-Claude-Code affordance.** The AI surfaces (Ask AI, Triage,
  Draft sprint, per-ticket "Work on this", sprint-level "Orchestrate
  sprint") do not call any hosted API. They generate clipboard prompts
  optimised for Claude Code so the user's existing Max subscription does
  the work. The per-ticket prompt adapts to status (backlog / progress /
  review / blocked / done branches) and to the presence of a description
  + worktree. The orchestration prompt spells out the fan-out + merge
  protocol and is dep-aware — it plans a topological wave, fans out only
  Wave 1, marks later waves as `blocked` upfront, and re-scans the
  blocked pool after each clean merge.
- **User `color`.** Optional per-user color for consistent avatar / chip
  tinting across the UI.
- **Sprint update payload** now accepts `status`, `startDate`, `endDate`
  (previously limited to name/description/goal).
- **Serve ergonomics.** `--port` / `--host` honor `TKXR_PORT` / `PORT`
  and `TKXR_HOST` env fallbacks. `EADDRINUSE` surfaces a clean hint
  instead of a stack trace, via handlers on both the HTTP server and
  the WebSocketServer.
- **`bump` script** accepts `major`, `minor`, `patch` (`node scripts/bump-version.js
  <level>` or `pnpm run bump:major` / `bump:minor` / `bump:patch`).
  Previously it was patch-only.

### Changed
- Sidebar rows split cleanly: click a row to open the sprint/user panel;
  hover-revealed filter icon toggles board scope.
- Drag-to-assign works on both board cards and list rows; persists via
  `PUT /api/tickets/:id`.
- Sprint `updateSprintStatus` now routes through `updateSprint` so
  notifier hooks fire from every path (REST / MCP / CLI), not just
  direct `updateSprint` calls.

### Migration Notes
- **Status enum.** No storage migration is required — `todo` reads as
  `backlog` transparently. On first write of a migrated ticket the file
  is normalised. External consumers of the raw JSON should still widen
  their expected enum before deploying against a 2.0 store.
- **UI.** No config to flip; the new UI ships as the default. Users on
  custom themes may need to re-apply overrides against the new CSS token
  set.
- **Worktrees.** Existing installs are unaffected; worktree fields are
  optional and only populated when `tkxr worktree create` (or the MCP
  equivalent) is invoked.

## [1.2.0] - 2026-07-02
### Added
- CLI: `tkxr edit <id>` for tickets — updates `--title`, `--description`, `--priority`, `--estimate`, plus repeatable `--add-label` / `--remove-label` and `--clear-labels` / `--clear-priority` / `--clear-estimate` / `--clear-description`.
- CLI: `tkxr user assign <ticket-id> <user>` (id or username) and `--unassign` to clear.
- CLI: `tkxr user edit <id-or-username>` — `--username`, `--display-name`, `--email`, `--clear-email`.
- CLI: `tkxr sprint set <ticket-id> <sprint-id>` and `--unset` to detach.
- CLI: `tkxr sprint edit <id>` — `--name`, `--description`, `--goal`, `--start-date`, `--end-date`, plus matching `--clear-*` flags.
- CLI: `tkxr comments <ticket-id> --delete <comment-id>`.
- CLI: `tkxr show <id>` is now polymorphic — accepts ticket, sprint, or user IDs.
- MCP: new tools `edit_ticket`, `assign_ticket`, `set_ticket_sprint`, `edit_sprint`, `edit_user`, `delete_comment`, `delete_entity` for parity with the CLI.
- Notifier: `notifyUserUpdated`, `notifyUserDeleted`, `notifySprintDeleted` events so the web UI stays in sync on user/sprint mutations.

### Fixed
- MCP `delete_ticket` never actually deleted — the underlying `delete` CLI requires `--force`, which the MCP handler was not sending. Now sends `--force`.
- `createUser` / `createSprint` failed with `ENOENT` on fresh repos that hadn't created any tickets yet, because the parent `tkxr/` directory did not exist. Both now `mkdir -p` before writing.
- Sprint `status` updates and delete operations for sprints/users now emit notifier events, so the web UI no longer goes stale after CLI mutations.

### Changed
- `storage.updateSprint` now accepts `startDate` and `endDate` in the update payload (was previously limited to name/description/goal).

## [1.1.16] - 2026-07-02
### Fixed
- MCP server no longer writes chalk-colored startup banner to stdout, which corrupted the JSON-RPC stream and caused AI tool calls (e.g. `create_ticket`) to fail when the server was launched via `pnpm dlx @legdev/tkxr mcp`. Banner is now written to stderr.
- `scripts/bump-version.js`: `updateChangelog` was defined after an early `return` inside `updatePackageVersion` and never ran; it is now hoisted to module scope and called from the main flow, so `pnpm run bump` actually appends a CHANGELOG entry.

### Docs
- README: replaced `pnpm dlx tkxr ...` / `npx tkxr ...` / `pnpm install -g tkxr` invocations with the scoped `@legdev/tkxr` name published to npm.
- README: added an MCP configuration example for `pnpm dlx`-based setups.

## [1.1.15] - 2026-02-22
### Added
- `bump` script: `pnpm run bump` to explicitly increment project versions.
- `scripts/copy-package-to-dist.js` to copy the root `package.json` into `dist` as part of the build.

### Changed
- Removed the `prebuild` lifecycle hook so builds no longer auto-run the bump script.
- `build` now executes the package copy script to populate `dist/package.json` after building assets.
- `scripts/bump-version.js` no longer writes `dist/package.json`; bumping and copying are decoupled.

### Fixed
- Prevent accidental automatic version increments during `pnpm run build`; ensures `dist/package.json` reflects the root package after build.

## [1.1.13] - 2026-02-22
### Changed
 - CLI now reads version from dist/package.json for npm deployment
 - Build script copies updated package.json to dist/ after version bump
 - Package is now fully self-sufficient for CLI and web deployment
### Changed
- CLI now reads version from dist/package.json for npm deployment
- Build script copies updated package.json to dist/ after version bump
- Package is now fully self-sufficient for CLI and web deployment

## [1.1.10] - 2026-02-22
### Added
- Open Tasks stat button to top row dashboard
- Sprint accordion view grouped by status (Planning, Active, Completed)
- Responsive ticket card status layout for smaller screens/split-view

### Changed
- Top-row stat buttons now enforce grid view when clicked
- Ticket status buttons redesigned as unified button group
- Sprint status buttons redesigned as unified button group with Planning option
- Sprint management modal organizes sprints by status with Active section expanded by default

### Fixed
- Status button compression issues on smaller screens
- Spacebar closing comments modal while typing
- Newly created task tickets not filling full width of kanban lane

## [1.1.2] - 2026-02-21
### Changed
- Automated patch version bump and sync for root and web package.json on each build.
- Version badge in web UI now reflects actual package version.
- CLI command added for manual version bump and sync.

### Fixed
- Complete Sprint button bug.

## [1.1.1] - 2026-02-20
### Added
- Initial version sync between root and web package.json.
- Version badge in web UI.

### Changed
- UI improvements for sprint combobox.

### Fixed
- Ticket status review and bug fixes.
