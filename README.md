# tkxr — In-Repo Ticket Manager

tkxr is a lightweight, file-based ticket manager that lives inside your repo. It ships with:

- a keyboard-driven **sidebar + panel** web UI (Svelte + Vite) for humans,
- a full **CLI** for scripting and shell workflows,
- an **MCP server** (stdio bin + HTTP `/mcp` endpoint) so AI agents can drive it,
- optional **per-ticket and per-sprint git worktrees** so multiple agents can work concurrently without stepping on each other.

Tickets and comments are stored as chunked NDJSON, sprints and users as JSON, all under `./tkxr/` in the working directory. Everything is text you can `git diff`.

---

## Installation

You can run tkxr without installing it globally:

```bash
pnpm dlx @legdev/tkxr serve    # web + REST + MCP-over-HTTP server
pnpm dlx @legdev/tkxr mcp      # MCP stdio server (for MCP client configs)
pnpm dlx @legdev/tkxr list     # any CLI subcommand

# Or via npx
npx @legdev/tkxr serve
```

Global install (optional, gives you the `tkxr` and `tkxr-mcp` bins on PATH):

```bash
pnpm install -g @legdev/tkxr
```

Requires Node ≥ 18.

---

## Quick start

```bash
# 1. Start the server (web UI + REST + MCP over HTTP)
pnpm dlx @legdev/tkxr serve
# → open http://localhost:8080

# 2. Or use the CLI directly
tkxr user create alice "Alice"
tkxr sprint create "Sprint 1" --goal "Ship auth"
tkxr create task "Wire up login form" --sprint spr-abc123 --priority high
tkxr status tas-abc12345 progress
tkxr comments tas-abc12345 --add --author alice --content "PR up for review"
```

Data lands in `./tkxr/`. Commit it like any other source file.

---

## Data model

| Entity        | ID prefix | Storage                                    | Notes |
|---------------|-----------|--------------------------------------------|-------|
| Ticket (task) | `tas-`    | `tkxr/tickets/tickets-XXXX.ndjson`         | one JSON object per line |
| Ticket (bug)  | `bug-`    | `tkxr/tickets/tickets-XXXX.ndjson`         | same shape, different type |
| Comment       | `com-`    | `tkxr/comments/comments-XXXX.ndjson`       | linked by `ticketId` |
| Sprint        | `spr-`    | `tkxr/sprints.json`                        | one file |
| User          | `use-`    | `tkxr/users.json`                          | one file |

### Ticket statuses (5-column board)

```
backlog → progress → review → done
                ↘ blocked ↙
```

`backlog`, `progress`, `review`, `blocked`, `done` — all valid targets for `tkxr status <id> <status>` and the MCP `update_ticket_status` tool.

### Sprint statuses

`planning → active → completed`. Completing a sprint that owns a worktree automatically removes the worktree.

### Users & per-user color

Every user has an optional `color` field. The web UI uses it for their avatar and their sidebar row; if unset, a color is picked from a small palette based on the user's index. Set it through the User panel in the web UI or the MCP `edit_user` / `create_user` tools.

### Dependencies

Tickets can declare inter-ticket blockers via `dependsOn: string[]`. Read tools (`list_tickets`, `get_ticket`) surface both `dependsOn` and a computed `blockedBy` (unmet or missing deps), so an orchestrator can topological-sort a sprint from a single call. Set them via the MCP `edit_ticket` tool (`dependsOn`, `addDependencies`, `removeDependencies`, `clearDependencies`) or `create_ticket` (`dependsOn`).

---

## Web UI

Open `http://localhost:8080` after `tkxr serve`.

Layout:

- **Left sidebar** — sprints, users, view switcher, theme toggle, command palette, AI Triage. Drag a ticket onto a sprint or user row to reassign.
- **Toolbar** — context title, search box, type filter, sort selector, "New ticket" button.
- **Main view** — either the 5-column **Board** or the **List** view. Board columns match the 5 statuses; drag between columns to move a ticket. Each column has an inline quick-add.
- **Sprint strip** — appears above the view when a sprint is selected, showing `done / total` story points.
- **Workspace panel** — a slide-in panel on the right for the currently selected ticket, sprint, user, or the AI Triage report. Never modal; you can keep the board visible behind it.
- **Command palette** — Cmd/Ctrl-K, full-text ticket search, quick actions, natural-language ticket draft ("critical bug: login crash for @alice").

### Keyboard shortcuts

| Key            | Action                                    |
|----------------|-------------------------------------------|
| `Cmd/Ctrl + K` | Toggle command palette                    |
| `/`            | Focus the toolbar search box              |
| `C`            | New ticket (opens the ticket panel)       |
| `B`            | Switch to Board view                      |
| `L`            | Switch to List view                       |
| `Esc`          | Close the workspace panel / palette       |
| `Enter`        | Commit a quick-add (in board columns) or send a comment (in ticket panel) |

Shortcuts are ignored while you are typing in an input.

The UI persists filters (view, active sprint, active user, type filter, sort, search) to `localStorage` under `tkxr-ui`.

### Live updates

Every mutation — from the UI, the CLI, or the MCP server — broadcasts a WebSocket event that the UI listens to and refetches on. You do not need to refresh.

---

## CLI

All commands accept `--help`. The most common are listed below.

### Tickets

```bash
tkxr create task "Wire up login" \
  --description "OAuth first, password fallback later" \
  --priority high --estimate 3 \
  --sprint spr-abc12345 --assignee alice

tkxr new bug "Dashboard crashes on empty state"       # alias for `create bug`

tkxr list                                              # all tickets
tkxr list tasks                                        # only tasks
tkxr list --status progress --sort-by priority
tkxr list --search "login" --verbose                   # -v shows assignee + sprint names
tkxr list --sprint spr-abc12345

tkxr show tas-abc12345                                 # polymorphic: also accepts spr- and use- ids
tkxr status tas-abc12345 review                        # backlog|progress|review|blocked|done
tkxr edit tas-abc12345 --priority critical --add-label backend
tkxr delete tas-abc12345 --force
```

### Comments

```bash
tkxr comments tas-abc12345                                            # list
tkxr comments tas-abc12345 --add --author alice --content "LGTM"      # add
tkxr comments tas-abc12345 --delete com-abc12345                      # delete
```

### Users

```bash
tkxr users
tkxr user create alice "Alice Smith" --email alice@example.com
tkxr user edit alice --display-name "Alice S." --email alice@example.com
tkxr user assign tas-abc12345 alice
tkxr user assign tas-abc12345 --unassign
```

### Sprints

```bash
tkxr sprints
tkxr sprint create "Sprint 1" --goal "Ship auth"
tkxr sprint status spr-abc12345 active                # planning|active|completed
tkxr sprint edit spr-abc12345 --name "Auth Sprint" --end-date 2026-08-01
tkxr sprint set tas-abc12345 spr-abc12345             # attach ticket to sprint
tkxr sprint set tas-abc12345 --unset                  # detach
```

### Worktrees

Per-ticket and per-sprint git worktrees let multiple agents work in parallel on isolated branches.

```bash
tkxr worktree create tas-abc12345
# → creates ../<repo>-worktrees/tas-abc12345 on branch tkxr/tas-abc12345,
#   based on the sprint branch if the ticket's sprint has a worktree, else HEAD.

tkxr worktree create spr-abc12345
# → creates ../<repo>-worktrees/sprints/spr-abc12345 on branch tkxr/sprint/spr-abc12345.

tkxr worktree list
tkxr worktree remove tas-abc12345                     # deletes the dir + branch
tkxr worktree remove tas-abc12345 --keep-branch       # keep the branch around
tkxr worktree remove spr-abc12345 --force
```

Options for `create`: `--path <dir>`, `--branch <name>`, `--base <ref>`.
Options for `remove`: `--force`, `--keep-branch`.
Override the worktree parent directory with the `TKXR_WORKTREE_ROOT` env var.

Ticket branches default to being based on the parent sprint's branch when the sprint has its own worktree, so per-ticket branches nest cleanly under the sprint branch.

### Servers

```bash
tkxr serve                                # web + REST + WebSocket + MCP-over-HTTP
tkxr serve --port 3000 --host 0.0.0.0
tkxr mcp                                  # MCP stdio server for MCP client configs
```

`serve` respects `TKXR_PORT` / `PORT` and `TKXR_HOST` env vars as fallbacks after the flags.

### Version

```bash
tkxr version                              # print current version
tkxr version --bump patch                 # patch | minor | major (updates root + web package.json)
```

---

## MCP (AI integration)

tkxr exposes the same functionality over the Model Context Protocol. There are two ways to connect:

1. **stdio** — the `tkxr-mcp` bin. Use this in editor MCP client configs (Claude Desktop, Cursor, Zed, etc.).
2. **HTTP** — every `tkxr serve` instance also serves MCP JSON-RPC at `/mcp`. Useful for agents that already talk HTTP or for remote setups.

Both transports expose the same tools and broadcast the same WebSocket events, so a running web UI reflects agent mutations live.

### Client config (stdio)

Global install:

```json
{
  "mcpServers": {
    "tkxr": {
      "command": "tkxr-mcp",
      "args": []
    }
  }
}
```

No global install (via `pnpm dlx`):

```json
{
  "mcpServers": {
    "tkxr": {
      "command": "pnpm",
      "args": ["dlx", "@legdev/tkxr", "mcp"]
    }
  }
}
```

Or via `npx`:

```json
{
  "mcpServers": {
    "tkxr": {
      "command": "npx",
      "args": ["-y", "@legdev/tkxr", "mcp"]
    }
  }
}
```

### Client config (HTTP)

Run `tkxr serve` (default `http://localhost:8080`), then point your client at `http://localhost:8080/mcp`. The endpoint speaks the MCP Streamable HTTP transport (JSON-RPC over `POST`/`GET`/`DELETE`). Session state is keyed by the `mcp-session-id` header.

You can also grab the tool list and the agent guide as plain REST:

```bash
curl http://localhost:8080/api/mcp/tools     # JSON tool list
curl http://localhost:8080/api/mcp/guide     # markdown agent guide
```

### Available MCP tools

Read: `agent_guide`, `list_tickets`, `get_ticket`, `search_tickets`, `list_users`, `get_user`, `list_sprints`, `get_sprint`, `list_comments`, `list_worktrees`.

Ticket mutations: `create_ticket`, `edit_ticket`, `update_ticket_status`, `assign_ticket`, `set_ticket_sprint`, `delete_ticket`.

Comment mutations: `add_comment`, `delete_comment`.

Sprint mutations: `create_sprint`, `edit_sprint`, `update_sprint_status`, `delete_sprint`.

User mutations: `create_user`, `edit_user`, `delete_user`.

Worktrees: `create_worktree`, `create_sprint_worktree`, `remove_worktree`.

Call `agent_guide` first if you're not sure — it returns a short markdown briefing on the data model, typical flow, dependency rules, and worktree conventions.

---

## Suggested worktree flow

For a single ticket:

```bash
tkxr worktree create tas-abc12345
cd ../<repo>-worktrees/tas-abc12345
tkxr status tas-abc12345 progress
# ... work, commit on the tkxr/tas-abc12345 branch ...
tkxr status tas-abc12345 review
tkxr comments tas-abc12345 --add --author alice --content "Ready for review"
```

When the ticket is merged (via your normal PR flow):

```bash
tkxr worktree remove tas-abc12345
```

For a sprint (fan-out to multiple agents):

```bash
tkxr worktree create spr-abc12345
# Each ticket in the sprint gets its own worktree, branched off the sprint branch:
tkxr worktree create tas-111
tkxr worktree create tas-222
# ... agents work concurrently ...
tkxr sprint status spr-abc12345 completed   # auto-removes the sprint worktree
```

---

## File layout

Inside your repo, tkxr writes:

```
tkxr/
├── tickets/
│   ├── tickets-0001.ndjson
│   └── tickets-0002.ndjson
├── comments/
│   ├── comments-0001.ndjson
│   └── comments-0002.ndjson
├── sprints.json
└── users.json
```

Example NDJSON ticket line:

```json
{"id":"tas-abc12345","type":"task","title":"Wire up login","status":"progress","assignee":"use-alice001","sprint":"spr-abc12345","estimate":3,"priority":"high","dependsOn":[],"worktree":{"path":"...","branch":"tkxr/tas-abc12345","createdAt":"..."},"createdAt":"...","updatedAt":"..."}
```

Example user:

```json
{
  "id": "use-alice001",
  "username": "alice",
  "displayName": "Alice Smith",
  "email": "alice@example.com",
  "color": "#e0864a",
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## REST API

`tkxr serve` exposes REST alongside the web UI, MCP, and WebSocket. Endpoints:

```
# Tickets
GET    /api/tickets
GET    /api/tickets/:type                (task|bug)
POST   /api/tickets
PUT    /api/tickets/:id
PUT    /api/tickets/:id/status
DELETE /api/tickets/:id

# Comments
GET    /api/tickets/:ticketId/comments
POST   /api/tickets/:ticketId/comments
DELETE /api/comments/:id

# Users
GET    /api/users
POST   /api/users
PUT    /api/users/:id
DELETE /api/users/:id

# Sprints
GET    /api/sprints
POST   /api/sprints
PUT    /api/sprints/:id
PUT    /api/sprints/:id/status
DELETE /api/sprints/:id

# Worktrees
GET    /api/worktrees
POST   /api/tickets/:id/worktree
DELETE /api/tickets/:id/worktree
POST   /api/sprints/:id/worktree
DELETE /api/sprints/:id/worktree

# MCP over HTTP
POST   /mcp
GET    /mcp
DELETE /mcp
GET    /api/mcp/tools                    (plain tool list)
GET    /api/mcp/guide                    (markdown agent guide)

# AI stubs (return scaffolded responses until wired to a model)
POST   /api/ai/ask
POST   /api/ai/create
POST   /api/ai/triage
POST   /api/ai/plan

# Server metadata
GET    /api/config                       ({ host, port, url, version })
```

### WebSocket

```js
const ws = new WebSocket('ws://localhost:8080');
ws.onmessage = (ev) => {
  const { type, data } = JSON.parse(ev.data);
  // type ∈ ticket_created | ticket_updated | ticket_deleted
  //      | comment_created | comment_deleted
  //      | sprint_created | sprint_updated | sprint_deleted
  //      | user_created | user_updated | user_deleted
};
```

---

## Configuration

`tkxr serve` dynamically writes `.tkxr-server` in its cwd with the host, port, and URL for the running web UI (default: `http://localhost:8080`) as JSON, so the notifier client, the Vite dev proxy, the CLI, MCP tools, and any other tooling can discover where the running server lives:

```json
{
  "host": "localhost",
  "port": 8080,
  "url": "http://localhost:8080"
}
```

The file is cleaned up on `SIGINT` shutdown. CLI/MCP commands also honor `TKXR_HOST` / `TKXR_PORT` (or `TKXR_SERVER_URL`) as env fallbacks when no `.tkxr-server` file is present.

Override any of these with flags or env vars:

- `--port <n>` / `TKXR_PORT` / `PORT`
- `--host <h>` / `TKXR_HOST`
- `TKXR_SERVER_URL` — full override for CLI/MCP when discovering a running server.
- `TKXR_WORKTREE_ROOT` — override the parent directory used for created worktrees.

```bash
pnpm dlx @legdev/tkxr serve --port 3000
```

---

## Development

```bash
git clone https://github.com/<your-fork>/tkxr
cd tkxr
pnpm install

# CLI + MCP (TypeScript)
pnpm run build:cli       # compiles src/ → dist/
pnpm run dev             # tsc --watch

# Web UI (Svelte + Vite, workspace package `tkxr-web`)
pnpm run dev:web         # Vite dev server
pnpm run build:web       # production build

# Everything
pnpm run build           # CLI + web + copy package.json into dist/
pnpm run typecheck

# Run locally against your built dist
pnpm run serve           # tkxr serve
pnpm run mcp             # tkxr mcp
```

---

## Contributing

1. Fork.
2. `git checkout -b feature/thing` (or let tkxr do it: `tkxr worktree create tas-…`).
3. Commit on your branch.
4. Open a PR.

## License

MIT — see [LICENSE](LICENSE).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).
