# Changelog

All notable changes to this project will be documented in this file.

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
