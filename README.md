# tkxr - In-Repo Ticket Management System

tkxr is a lightweight, file-based ticket management system with a modern web UI for human users, and CLI/MCP server interfaces for AI and automation. It uses chunked NDJSON for tickets/comments and JSON for sprints/users, ensuring scalable, fast, and version-controlled workflows. Ideal for small teams wanting Jira-like functionality without external dependencies.

## Features

- 📁 **File-based Storage** - Tickets and comments stored as NDJSON chunks, sprints/users as JSON
- 🌐 **Web Dashboard** - The primary interface for humans to view, manage, and interact with tickets, sprints, users, and comments
- 🚀 **CLI Interface** - Designed for automation, scripting, and AI agents to manage tickets
- 🤖 **AI Integration** - MCP server enables AI assistants to interact with tickets, sprints, users, and comments
- 🔄 **Real-time Updates** - WebSocket-powered live updates
- 🏃 **Sprint Management** - Complete sprint lifecycle management
- 👥 **User Management** - Assign tickets to team members
- 💬 **Comment Support** - Add, list, and manage comments for tickets
- ⚡ **Zero Dependencies** - No external databases required

## Installation

### Run tkxr instantly with npx or pnpm dlx

You do not need to install tkxr globally. Run any command directly using pnpm dlx or npx:

```bash
# Using pnpm dlx
pnpm dlx tkxr serve         # Start the web interface
pnpm dlx tkxr mcp           # Start the MCP server
pnpm dlx tkxr list          # List tickets
pnpm dlx tkxr create task "Title"  # Create a task
pnpm dlx tkxr comments <ticket-id>  # Manage comments

# Using npx
npx tkxr serve              # Start the web interface
npx tkxr mcp                # Start the MCP server
npx tkxr list               # List tickets
npx tkxr create task "Title"       # Create a task
npx tkxr comments <ticket-id>      # Manage comments
```

Global install is optional:

```bash
pnpm install -g tkxr
```

## Quick Start
> **Human users:** Use the web UI for all ticket management, sprint planning, and user interactions. Open http://localhost:8080 after running `pnpm dlx tkxr serve`.
> **AI/automation:** Use the CLI or MCP server for programmatic access, scripting, and integration with AI tools.

### 1. Create your first tickets and comments

```bash
tkxr create task "Implement user login"
tkxr create bug "Fix navigation menu"
tkxr sprint create "Sprint 1 - Authentication"
tkxr user create johndoe "John Doe" --email john@example.com
# Add a comment to a ticket
tkxr comments tas-AbCdEfGh --add --author johndoe --content "This is a comment"
```

### 2. List and manage entities

```bash
tkxr list
tkxr users
tkxr sprints
tkxr sprint status spr-abc123 active
tkxr comments tas-AbCdEfGh           # List comments for a ticket
```

### 3. Update ticket status

```bash
# Mark ticket as in progress
tkxr status tas-AbCdEfGh progress

# Mark ticket as done
tkxr status tas-AbCdEfGh done
```

### 4. Start interfaces

```bash
# Web interface (human-friendly)
tkxr serve

# MCP server (AI integration)
tkxr mcp
```

Open http://localhost:8080 in your browser to access the web dashboard.

## CLI Commands

### Ticket & Comment Commands

```bash
# Create tickets with options
tkxr create task "Task title" \
  --description "Detailed description" \
  --assignee usr-12345678 \
  --sprint spr-12345678 \
  --priority high \
  --estimate 5

tkxr create bug "Bug title" \
  --description "Bug description" \
  --priority critical

# List tickets
tkxr list                    # All tickets
tkxr list tasks              # Only tasks
tkxr list bugs               # Only bugs

# Update status
tkxr status <ticket-id> <status>
# Valid statuses: todo, progress, done

tkxr delete <ticket-id>

# Comment management
tkxr comments <ticket-id>             # List comments
tkxr comments <ticket-id> --add --author <user-id> --content "Comment text"   # Add comment
```

### User Management

```bash
# List all users
tkxr users

# Create a new user
tkxr user create <username> <displayName> [--email <email>]

# Examples
tkxr user create johndoe "John Doe"
tkxr user create alice "Alice Smith" --email alice@example.com
```

### Sprint Management

```bash
# List all sprints
tkxr sprints

# List sprints by status
tkxr sprints --status active

# Create a new sprint
tkxr sprint create <name> [options]

# Sprint creation options
tkxr sprint create "Sprint 2" \
  --description "Feature development sprint" \
  --goal "Complete user authentication"

# Update sprint status
tkxr sprint status <sprint-id> <status>
# Valid statuses: planning, active, completed

# Examples
tkxr sprint status spr-abc123 active
tkxr sprint status spr-def456 completed
```

### Server Commands

```bash
# Web interface server
tkxr serve                   # Start on localhost:8080
tkxr serve --port 3000       # Custom port
tkxr serve --host 0.0.0.0    # Custom host

# MCP server for AI integration
tkxr mcp                     # Start MCP server
```

## AI Integration (MCP Server)

tkxr includes a Model Context Protocol (MCP) server that enables AI assistants to manage tickets through standardized tool calls.

### Starting the MCP Server

```bash
npx tkxr mcp           # If not installed globally
pnpm dlx tkxr mcp      # Or use pnpm dlx
tkxr mcp               # Only if installed globally
```

### Available MCP Tools

The MCP server provides these tools for AI assistants:

- `list_tickets` - List all tickets with optional filtering
- `create_ticket` - Create new tasks or bugs
- `update_ticket_status` - Change ticket status
- `delete_ticket` - Remove tickets
- `list_users` / `create_user` - User management
- `list_sprints` / `create_sprint` / `update_sprint_status` - Sprint management
- `list_comments` / `add_comment` - Comment management

- `list_tickets` - List all tickets with optional filtering
- `create_ticket` - Create new tasks or bugs
- `update_ticket_status` - Change ticket status
- `delete_ticket` - Remove tickets
- `list_users` / `create_user` - User management
- `list_sprints` / `create_sprint` / `update_sprint_status` - Sprint management

### AI Usage Examples

With the MCP server running, AI assistants can:

```
"Show me all open tasks in the current sprint"
"Create a new bug for the login issue and assign it to John"
"Move all completed tickets from Sprint 1 to done status"
"Start Sprint 2 and create initial planning tasks"
```

### MCP Configuration

Configure your AI assistant to connect to the MCP server:

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

## Web Interface Features

### Dashboard
- 📊 Overview statistics (sprint-aware)
- 🎯 **Sprint dropdown filter** - Filter by specific sprint or "No Sprint"
- 📋 Ticket cards with status indicators
- 💬 Comment modal for ticket conversations
- 🔄 Real-time updates via WebSocket
- 📈 Dynamic stats that update based on sprint selection

### Sprint Filtering
- **All Tickets** - Show everything
- **No Sprint** - Show unassigned tickets  
- **Active Sprints** - Filter by specific sprint (completed sprints hidden)
- Stats and tab counts update automatically based on selected sprint

### Ticket Management
- ✅ Quick status updates
- 📝 Create new tickets with rich forms
- 🏷️ Priority and label management
- 👤 User assignment
- 🏃 Sprint assignment (only active/planning sprints shown)

### Sprint Management
- 🏃 **Complete sprint lifecycle**: planning → active → completed
- 🎯 Sprint status buttons (Start, Complete, Reopen)
- 📋 Sprint creation with description and goals
- 🚫 Smart filtering (completed sprints hidden from ticket creation)

### Visual Indicators
- 🟦 Tasks (blue)
- 🔴 Bugs (red)
- 🟡 In Progress (yellow)
- 🟢 Done (green)
- ⚪ Todo (gray)

## File Structure

tkxr organizes tickets, comments, sprints, and users in your repository:

```
tkxr/
├── tickets/
│   ├── tickets-0001.ndjson
│   └── tickets-0002.ndjson
├── comments/
│   ├── comments-0001.ndjson
│   └── comments-0002.ndjson
├── sprints.json
├── users.json
```

### Example Files

#### Ticket (NDJSON)
Each line is a JSON object:
{"id":"tas-12AbCdEfGh","type":"task","title":"Implement user authentication","description":"Add user authentication system...","status":"progress","assignee":"usr-98XyZaBc","sprint":"spr-45FgHiJk","estimate":8,"priority":"high","createdAt":"2026-02-19T10:30:00.000Z","updatedAt":"2026-02-19T14:15:00.000Z"}

#### Sprint (JSON)
{
  "id": "spr-45FgHiJk",
  "name": "Sprint 1 - Authentication",
  "description": "Implement core authentication features",
  "status": "active",
  "goal": "Complete user login and registration",
  "createdAt": "2026-02-19T09:00:00.000Z",
  "updatedAt": "2026-02-19T11:00:00.000Z"
}

#### User (JSON)
{
  "id": "usr-98XyZaBc",
  "username": "johndoe",
  "displayName": "John Doe",
  "email": "john@example.com",
  "createdAt": "2026-02-19T08:00:00.000Z",
  "updatedAt": "2026-02-19T08:00:00.000Z"
}
#### Comment (NDJSON)
Each line is a JSON object:
{"id":"com-1a2b3c4d","ticketId":"tas-12AbCdEfGh","author":"usr-98XyZaBc","content":"This is a comment","createdAt":"2026-02-19T12:00:00.000Z"}

## Advanced Usage
# Comment workflows
tkxr comments tas-12AbCdEf --add --author johndoe --content "Ready for review"
tkxr comments tas-12AbCdEf           # List all comments for ticket

### Sprint Workflow

```bash
# Complete sprint lifecycle
tkxr sprint create "Sprint 1" --goal "Complete MVP"
tkxr sprint status spr-abc123 active
tkxr create task "Add login" --sprint spr-abc123
tkxr create task "Add dashboard" --sprint spr-abc123
# ... work on tickets ...
tkxr sprint status spr-abc123 completed

# Planning next sprint
tkxr sprint create "Sprint 2" --goal "User management"
# Only active/planning sprints appear in ticket creation
```

### Integration with Git

Since tickets are files, they integrate naturally with Git:

```bash
# Track ticket changes
git add tickets/
git commit -m "Add feature tickets for sprint 1"

# Branch-specific tickets
git checkout feature/auth
tkxr create task "Add OAuth integration"

# Review ticket history
git log --follow tickets/tasks/tas-12345678.yaml
```

### AI-Powered Workflows

```bash
# Start MCP server for AI integration
tkxr mcp

# AI can now:
# - Analyze ticket backlogs
# - Create tickets from requirements
# - Update sprint progress
# - Generate reports
# - Manage assignments
```

## API Reference
# Comments
GET  /api/comments/:ticketId         # List comments for ticket
POST /api/comments/:ticketId         # Add comment to ticket

### REST API

When running `tkxr serve`, the following API endpoints are available:

```
# Tickets
GET  /api/tickets                    # All tickets
GET  /api/tickets/:type              # Tickets by type (task/bug)
POST /api/tickets                    # Create ticket
PUT  /api/tickets/:id/status         # Update ticket status
DELETE /api/tickets/:id              # Delete ticket

# Users
GET  /api/users                      # All users
POST /api/users                      # Create user
DELETE /api/users/:id               # Delete user

# Sprints
GET  /api/sprints                    # All sprints
POST /api/sprints                    # Create sprint
PUT  /api/sprints/:id/status         # Update sprint status
DELETE /api/sprints/:id              # Delete sprint
```

### WebSocket Events

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:8080/ws');

// Listen for updates
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Update:', message.type, message.data);
};
```

## Configuration
# Server Configuration

The `.env.tkxr` file is dynamically created by the web UI server. It stores the host, port, and URL for the web interface (default: http://localhost:8080) in standard dotenv format:

```
TKXR_HOST=localhost
TKXR_PORT=8080
```

You can override the web UI port by editing `.env.tkxr`, using CLI flags:

```bash
pnpm dlx tkxr serve --port 3000
```
### Development

```bash
# Clone and develop
git clone <repo>
cd tkxr
npm install

# Build CLI and web interface
npm run build

# Develop web interface
cd src/web
npm install
npm run dev

# Test MCP server
npm run build
tkxr mcp
```

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## License

MIT License - see LICENSE file for details.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed history of all notable changes.

### Recent Highlights
- Automated patch version bump and sync for root and web package.json on each build
- Version badge in web UI now reflects actual package version
- CLI command added for manual version bump and sync
- Changelog is updated automatically with each build
- Complete Sprint button bug fixed

## Version Management

### Automatic Patch Bump
Every build automatically bumps the patch version and syncs both root and web package.json files. This is handled by the `scripts/bump-version.js` script, which also updates the changelog.

### Manual Version Control
You can manually bump the patch, minor, or major version using the CLI:

```bash
node dist/cli/index.js version --bump patch   # Patch bump
node dist/cli/index.js version --bump minor   # Minor bump
node dist/cli/index.js version --bump major   # Major bump
node dist/cli/index.js version                # Show current version
```

Both methods keep the root and web package.json files in sync.