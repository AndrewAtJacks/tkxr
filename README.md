# tkxr - In-Repo Ticket Management System

A lightweight, file-based ticket management system with CLI and web interface. Perfect for small teams who want Jira-like functionality without external dependencies.

## Features

- 📁 **File-based Storage** - Tickets stored as YAML files in your repo
- 🚀 **CLI Interface** - Manage tickets from the command line
- 🌐 **Web Dashboard** - Beautiful web UI with sprint filtering
- 🤖 **AI Integration** - MCP server for AI-powered ticket management
- 🔄 **Real-time Updates** - WebSocket-powered live updates
- 🏃 **Sprint Management** - Complete sprint lifecycle management
- 👥 **User Management** - Assign tickets to team members
- 🏷️ **Labels & Priorities** - Organize and prioritize work
- ⚡ **Zero Dependencies** - No external databases required

## Installation

Install globally via npm:

```bash
npm install -g tkxr
```

Or use directly with npx:

```bash
npx tkxr --help
```

## Quick Start

### 1. Create your first tickets

```bash
# Create a task
tkxr create task "Implement user login"

# Create a bug
tkxr create bug "Fix navigation menu"

# Create a sprint
tkxr sprint create "Sprint 1 - Authentication"

# Create a user
tkxr user create johndoe "John Doe" --email john@example.com
```

### 2. List and manage entities

```bash
# List all tickets
tkxr list

# List users and sprints
tkxr users
tkxr sprints

# Update sprint status
tkxr sprint status spr-abc123 active
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

### Ticket Commands

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

# Delete tickets
tkxr delete <ticket-id>
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
tkxr mcp
```

### Available MCP Tools

The MCP server provides these tools for AI assistants:

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

tkxr organizes tickets in your repository:

```
tickets/
├── tasks/
│   ├── tas-AbCdEfGh.yaml
│   └── tas-XyZ12345.yaml
├── bugs/
│   ├── bug-MnOpQrSt.yaml
│   └── bug-UvWx6789.yaml
├── sprints/
│   ├── spr-12345678.yaml
│   └── spr-87654321.yaml
└── users/
    ├── usr-UserAbc1.yaml
    └── usr-UserDef2.yaml
```

### Example Files

#### Ticket (YAML)
```yaml
id: tas-12AbCdEf
type: task
title: Implement user authentication
description: |
  Add user authentication system with login/logout functionality.
  Requirements:
  - Login form with validation
  - Session management
  - Protected routes
status: progress
assignee: usr-98XyZaBc
sprint: spr-45FgHiJk
estimate: 8
priority: high
createdAt: 2026-02-19T10:30:00.000Z
updatedAt: 2026-02-19T14:15:00.000Z
```

#### Sprint (YAML)
```yaml
id: spr-45FgHiJk
name: Sprint 1 - Authentication
description: Implement core authentication features
status: active
goal: Complete user login and registration
createdAt: 2026-02-19T09:00:00.000Z
updatedAt: 2026-02-19T11:00:00.000Z
```

#### User (YAML)
```yaml
id: usr-98XyZaBc
username: johndoe
displayName: John Doe
email: john@example.com
createdAt: 2026-02-19T08:00:00.000Z
updatedAt: 2026-02-19T08:00:00.000Z
```

## Advanced Usage

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
tkxr mcp &

# AI can now:
# - Analyze ticket backlogs
# - Create tickets from requirements
# - Update sprint progress
# - Generate reports
# - Manage assignments
```

## API Reference

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

### Environment Variables

```bash
# Custom ticket directory
export TKXR_TICKETS_DIR="./project-tickets"

# Custom server settings
export TKXR_DEFAULT_PORT="3000"
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

---

**tkxr** - Making ticket management simple, transparent, version-controlled, and AI-powered. 🎯