# Changelog

## [Unreleased]

### Added
- **Epic entity (`epi-*`).** New top-level record in `tkxr/epics.json`
  with `name`, `description`, `goal`, `color`, `status`
  (`planning | active | completed`) and an owning `sprint`. `Ticket`
  gains an `epic` field. Deleting an epic ungroups its tickets rather
  than deleting them; deleting a sprint detaches its epics instead of
  cascading.
- **Sprint switcher.** Picking a workspace is its own full view now,
  not an inline toolbar filter. Reached from the sidebar "Switch"
  button, and shown as a gate when no workspace is active.
- **Unsorted workspace.** A pseudo-workspace backed by the existing
  `sprint=none` sentinel. Appears in the switcher whenever sprintless
  tickets exist, so nothing is stranded by the new gate.
- **Epics in the sidebar.** Replaces the old sprint list. Epic rows
  filter the board, carry a done/total badge sourced from the scoped
  `/api/tickets/summary`, and accept a dragged ticket to assign it.
  `EpicPanel` handles epic CRUD and shows the epic's ticket count,
  points done and ticket list from its own scoped fetch; board cards
  and list rows show a colored epic chip.
- **Epic REST surface.** `GET/POST /api/epics` and
  `PUT/DELETE /api/epics/:id`, broadcasting `epic_created` /
  `epic_updated` / `epic_deleted`. `GET /api/epics` accepts
  `?sprint=<id>` or `?sprint=none`. `GET /api/tickets` accepts
  `?epic=<id>` or `?epic=none`.
- **Epic CLI.** `tkxr epics [--sprint <id>|none] [--status …]`;
  `tkxr epic create|status|set|edit` and `tkxr create epic <name>`;
  `--epic <id>|none` on `tkxr list`; a `tkxr list epics` entity type;
  `--epic` on `tkxr create` and `tkxr edit` (plus `--clear-epic`);
  `tkxr show <epi-*>`; and `tkxr delete <epi-*>`, which reports the
  tickets it ungrouped. CLI epic mutations live-refresh an open board
  through new `/api/cli-notifications/epic-*` endpoints.
- **Epic MCP tools.** `list_epics`, `get_epic`, `create_epic`,
  `edit_epic`, `delete_epic`, `set_ticket_epic`. `epic` accepted on
  `create_ticket` / `edit_ticket` and resolved by `get_ticket`.
- **Epic worktrees.** `tkxr worktree create|remove <epi-*>` creates
  `../<repo>-worktrees/epics/<epic-id>` on `tkxr/epic/<epic-id>`, based
  on `HEAD` — this is the feature branch its tickets merge into. `Epic`
  gains a `worktree` field. Exposed as
  `POST`/`DELETE /api/epics/:id/worktree` and the
  `create_epic_worktree` / `remove_epic_worktree` MCP tools.
- **Per-epic branch insights + PR flow.** `GET /api/epics/:id/git` and
  `POST /api/epics/:id/pr`, mirroring the ticket routes. An
  epic PRs into the repo default — the epic branch *is* the feature
  branch. `EpicPanel` renders the worktree card and `BranchInsights`
  for it.
- **Plan epic with Claude.** `EpicPanel` action mirroring the sprint
  planner: turns the epic's goal into child tickets in waves via
  `dependsOn`, capped at ~12 and forbidden from touching existing
  tickets. Enabled once the epic has a goal.
- **Review epic code with Claude.** New `EpicPanel` action that reviews
  the epic branch and every ticket branch under it in one pass, rather
  than one ticket at a time — the defects it exists to catch are the
  ones between tickets: the same helper written twice, one ticket
  invalidating another's assumption, a convention applied in three
  places out of four. Runs in the epic worktree, diffs against whatever
  the epic branch forked from, and reports findings as ticket comments
  plus one ranked summary with a mergeable / not verdict. Read-only by
  construction: the prompt forbids edits, commits, merges and status
  changes. Enabled once the epic or one of its tickets has a branch.
- **Story points in `/api/tickets/summary`.** New `points`
  (`{ total, done }` for the scoped workspace) and `pointsByEpic`
  fields. Sidebar epic rows use them for a done/total burn badge, so
  the number is correct with only page 1 of tickets loaded.
- **Group the backlog into epics.** The triage panel's ungrouped-backlog
  finding now offers a Claude hand-off that buckets loose backlog
  tickets into epics (capped at 5, no status/priority changes).
- **Sprint status management.** Completed sprints now have somewhere to
  go. The sprint switcher splits into in-flight and a collapsed
  **Completed** section, each card carries a done/total progress bar and
  an inline planning / active / completed control, and a card whose
  tickets are all done says so. Setting status no longer means opening
  `SprintPanel` first — the picker is the one screen where every sprint
  is visible side by side, which is where that comparison happens.
- **"Complete sprint?" prompt.** Once every ticket in the active
  workspace is done and the sprint is still open, a dismissible card
  appears in the board's bottom-right corner with a one-click complete
  action. Dismissals are per sprint and persist, but clear themselves
  once the workspace stops being finished, so adding and finishing more
  work prompts again. Suppressed while a side panel or Claude run panel
  is open.
- **Epic rollup on completion.** Completing a sprint marks every epic
  under it `completed` too, on every path: `tkxr sprint complete <id>`,
  `tkxr sprint status <id> completed`, `PUT /api/sprints/:id`,
  `PUT /api/sprints/:id/status`, the new
  `POST /api/sprints/:id/complete`, and the MCP `update_sprint_status`
  tool. Epic status is a manual label that lags its tickets, so without
  the rollup a closed workspace kept reporting active epics. Tickets are
  untouched — carrying open tickets out of a completed sprint is normal,
  and the CLI reports which ones they are rather than blocking.
- **`sprintProgress` in `/api/tickets/summary`.** The done/open split
  behind `bySprint`, also project-wide. Backs the switcher's progress
  bars and the ready-to-complete test. `bySprint` keeps its flat-count
  shape.
- **`tkxr sprint complete <id>`.** Completes a sprint, lists the epics it
  rolled up, and reports any tickets left open.

### Changed
- **`tkxr sprints` groups by lifecycle.** In flight, then planning, then
  completed (newest first within each), with a done/total ticket count
  per sprint and a ready-to-complete flag — the CLI mirror of what the
  switcher now shows. A `--status` filter still prints a flat list.
- **Clicking an epic in the sidebar filters the board.** Editing moved
  to a small pencil button on the right of the row. It used to be the
  other way round, which put the rarer action on the bigger target —
  you pick an epic to look at its tickets far more often than to rename
  it (tas-StJGUFto).
- **Long comments collapse by default.** A comment over 12 lines or 900
  characters shows its opening few lines plus a "Show more" toggle that
  says how much is hidden. Agent comments routinely run to hundreds of
  lines and buried the conversation; anything a human typically types is
  untouched (tas-YerLNB5a).

- **A sprint is now required to enter the board.** With no active
  workspace you land on the switcher instead of an unscoped ticket
  list, and the board, sidebar counts and `/api/tickets/summary` are
  all scoped to the active sprint. _Migration:_ nothing is rewritten on
  disk. Tickets that already have a sprint open under it; tickets
  without one are reachable through the **Unsorted** workspace, which
  the switcher offers automatically whenever any exist. Existing
  sprints all appear in the switcher.
- **Deleting a sprint** now says where its tickets and epics go — the
  Unsorted workspace — since under the new model detaching them moves
  them out of every sprint view rather than just clearing a tag.
- `PUT /api/epics/:id` whitelists its updatable fields and validates
  `status`, matching the sprint route.
- `--sprint` and `--epic` are validated on every CLI path that accepts
  them. A dangling reference surfaces no error anywhere downstream, it
  just hides the entity, so unknown ids now exit `1`.
- **Ticket branches base on their epic branch.** The base is the epic
  branch when the epic has a worktree, else `HEAD` — a ticket with no
  epic is a standalone change and forks from the repo default. Branch
  insights and the ticket PR base follow the same rule.
- **`tkxr delete` warns when the entity owns a worktree.** Deleting
  never removes one, and the record is the only thing that remembers
  the path, so the pre-delete summary now prints the path, the branch
  and the `tkxr worktree remove <id>` needed to clean it up. The web
  UI already warned in its confirm dialog; the CLI orphaned the
  directory silently. Applies to tickets, epics and sprints.
- **`tkxr show` prints the worktree path and branch** for tickets,
  epics and sprints. It never did for any of them, so the only way to
  find where an entity's branch lived was `tkxr worktree list` plus
  guesswork about which directory belonged to what.
- **Both worktree surfaces report the same shape.** Every
  `create_*_worktree` (CLI, REST, MCP) resolves and reports `basedOn`,
  and every `remove_*_worktree` reports `branchKept`, so which entity
  you asked about no longer changes what you get back.
- **Epic `color` is validated** on every write path (REST, MCP, CLI) —
  it's interpolated into an inline `style`, and an unconstrained string
  let extra declarations ride along. Hex literals only, enforced in
  `createEpic` / `updateEpic` as well as at each call site, so the
  invariant travels with the write instead of with six callers.
- **"Group with Claude" plans the whole backlog, not the visible page.**
  The triage action handed Claude the board's paged, filtered ticket
  store, so an active filter or a backlog past the 50-row first page
  meant Claude grouped a fraction and reported the job done. It now
  fetches its own workspace-scoped slice of ungrouped backlog.
- **`/api/ai/plan` drafts an epic, not a sprint.** It selected from
  backlog tickets with no sprint, which is always empty now that a
  sprint frames the workspace. It now buckets a workspace's *ungrouped*
  backlog into an epic; body accepts `{ sprint?, capacity?, commit? }`.
  The matching `/api/ai/triage` finding changed from `draft_sprint` to
  `draft_epics`, and the client's dead `draft_sprint` branches are gone.
- **Board cards no longer carry a sprint-name chip** when a ticket has
  no epic. The board is workspace-scoped, so it was the same chip on
  every card — the reasoning `ListView` used to drop its Sprint column.
- **The toolbar title reflects a person filter again.** Filtering by
  someone retitles the toolbar to their name with the epic/workspace in
  the subtitle; since epics landed only the sidebar highlight showed it.
- **Drag-to-ungroup targets the "No epic" row**, not "All tickets",
  which is what it actually does. The row stays visible whenever any
  epic exists so the target is always reachable.
- `--goal` and `--color` on `tkxr create epic` are documented in
  `--help` and the README, and echoed back on create.
- **In-review tickets get a code review, not more work.** The ticket panel's
  agent actions used to offer "Work on this" and "Commit with Claude" while a
  ticket sat in `review` — both assume the implementation is unfinished. A
  ticket in review is supposed to be done, so those are replaced by a single
  **Code review this** action backed by a new `codeReviewTicketPrompt`. The
  prompt tells the agent to read the full change set (worktree diff, or commits
  matched by ticket id when there's no worktree), review the related code —
  correctness, completeness, regressions, conventions, tests, security — post
  one structured `add_comment` with a verdict plus `file:line` findings, and
  then set the status: back to `progress` when anything is outstanding, `done`
  when clean, unchanged when it can't tell. It explicitly must not implement
  the fix or commit. `workOnTicketPrompt` now short-circuits to the same prompt
  for `review` tickets, so every entry point agrees.

### Removed
- **Sprint-level branches and orchestration.** A sprint frames concurrent
  work; an epic is the thing that maps to a feature branch. Sprints no
  longer own a branch or a worktree, and the only sprint-level activity
  left is triage — sorting a sprint's tickets into epics. Removed:
  `tkxr worktree create|remove <spr-*>`, `POST`/`DELETE
  /api/sprints/:id/worktree`, `GET /api/sprints/:id/git`,
  `POST /api/sprints/:id/pr`, the `create_sprint_worktree` /
  `remove_sprint_worktree` MCP tools, and the sprint orchestrate /
  commit / plan actions with their prompts. The epic equivalents already
  exist. `Sprint.worktree` stays in the type as read-only legacy so
  pre-existing records don't silently lose the path — `tkxr show <spr-*>`
  still prints it, and `git worktree remove` cleans one up. Rationale and
  the tradeoff this accepts: `docs/branching-model.md`.

- `commitTicketPrompt` (ticket-level "Commit with Claude"). Committing belongs
  to the implementer before the ticket reaches review; the sprint-level
  `commitSprintPrompt` is unchanged.

### Fixed
- **`PUT /api/sprints/:id/status` broadcasts again.** It was the one
  sprint mutation that skipped the WS broadcast its sibling
  `PUT /api/sprints/:id` sends, so a status change never reached other
  open boards — the card kept its old colour until a manual reload.
- **A ticket moved between board columns no longer disappears.** Each
  board column is its own paged store scoped to one status, so a status
  change is two events: the source column drops the row, and the
  destination column was ignoring it because the ticket wasn't already
  in its page. The ticket vanished from the board entirely until a
  manual refresh. The destination column now injects it, which is safe
  because page appends dedupe by id — a later page returning the same
  row replaces it instead of adding a second copy (bug-jJnasGns).
- **A successful worktree removal no longer prunes other half-removed
  worktrees.** `git worktree prune` is repo-global, so the prune that
  ran after every successful removal swept the admin entry of any
  worktree whose `.git` file was missing — turning a partial failure
  that `git worktree repair` could still fix into an unrecoverable
  orphan. That is the same outcome bug-MtPFb7dg was filed for, reached
  by a different route. There is now no prune at all: `git worktree
  remove` already clears its own entry on success, and on failure the
  entry has to survive so the removal can be retried or repaired
  (bug-NGyF3rA_).
- **A worktree record can be cleared once git has forgotten the path.**
  Removal shelled out to `git worktree remove` unconditionally, so if
  git no longer tracked the path the command failed with "is not a
  working tree" and the record survived — on every surface, on every
  retry, with no way out but editing the store by hand. Removal now
  checks whether git tracks the path first and treats "it doesn't" as
  the end state already holding: the record is cleared and the response
  says so via `alreadyUntracked`, plus `dirRemains` when the directory
  is still on disk and only the user can delete it (bug-6Kx3khqN).
- **Panel edits inside the save debounce are no longer dropped.**
  `schedulePatch` cleared its pending timer and re-armed it closed over
  its *own* patch, so two field edits within 300ms sent only the second
  — while both had already been applied locally, so the panel showed the
  lost edit as saved until a reload silently reverted it. Patches now
  coalesce into one pending object, and a failed send folds its fields
  back so the next edit retries them. Fixed in `EpicPanel`,
  `SprintPanel` and `TicketPanel`, which all shared the shape
  (bug-7bVl3-Kj).

Sprints change role: a sprint now frames the whole workspace instead of
being one grouping among many, and **epics** take over the job of
grouping tickets inside it. This changes what you see on first load —
see the migration note under _Changed_.

- **CLI notifications 404'd for three mutations.** `notifier` called
  `/api/cli-notifications/{sprint-deleted,user-updated,user-deleted}`,
  which `serve.ts` never registered — so `tkxr delete <spr-*>`,
  `tkxr user edit` and `tkxr delete <use-*>` printed a 404 warning and
  left an open board stale until a manual reload. All three handlers
  now exist and broadcast `sprint_deleted` / `user_updated` /
  `user_deleted`. Pre-existing; predates the epic work.
- **Deleting a sprint left its epics rendering under a dead workspace.**
  `deleteSprint` detached them on disk but never returned them, so
  nothing re-broadcast. It now returns `sweptEpics` alongside
  `sweptTickets`, and the CLI, REST and MCP delete paths all fan out
  `epic_updated` (and `ticket_updated`) for them.
- **A legacy `activeSprint: 'all'` in `localStorage` survived.** It's
  not a sprint id, so the reset guard couldn't clear it in a project
  with zero sprints and it got re-persisted. It's now mapped to "no
  workspace picked" on restore.
- **`tkxr list -v` printed the version instead of a verbose listing.**
  The global version flag swallowed `-v` before subcommands saw it.
  `-v` is now the version alias only for a bare `tkxr -v`.

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
