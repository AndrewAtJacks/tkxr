import chalk from 'chalk';
import type minimist from 'minimist';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { promises as fs, unlinkSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { createStorage, type TicketQueryOptions, type TicketSortBy } from '../../core/storage.js';
import { notifier } from '../../core/notifier.js';
import { SERVER_INSTRUCTIONS, TOOL_MAP, TOOLS, type ToolContext } from '../../mcp/tools.js';
import { createSprintWorktree, createWorktree, getRepoRoot, isGitRepo, listWorktrees, removeWorktree } from '../../core/worktree.js';
import { getBranchInsights, getRemoteInfo } from '../../core/gitInsights.js';
import {
  discoverClaude,
  killWithGrace,
  spawnClaude,
  toPublicConfig,
  type ClaudeConfig,
  type ClaudeRun,
} from '../../core/claude.js';
import type { ChildProcessWithoutNullStreams } from 'child_process';

interface ServeArgs extends minimist.ParsedArgs {
  port?: number;
  host?: string;
}

export async function startServer(args: ServeArgs): Promise<void> {
  // Precedence: --port flag > TKXR_PORT env > PORT env > 8080 default.
  const envPort = process.env.TKXR_PORT || process.env.PORT;
  const port = Number(args.port) || (envPort ? Number(envPort) : 8080);
  const host = args.host || process.env.TKXR_HOST || 'localhost';
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error(chalk.red(`Invalid port: ${args.port ?? envPort}`));
    process.exit(1);
  }
  
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  
  const storage = await createStorage();

  // Probe the user's `claude` CLI once at boot. Cached on `app.locals.claude`
  // so `GET /api/config` and the downstream spawn handler (tas-5j83ACCR) both
  // read from a single source of truth — no re-probing per request. See
  // `docs/claude-cli-integration.md` §2 for env precedence.
  const claudeConfig: ClaudeConfig = await discoverClaude();
  app.locals.claude = claudeConfig;
  if (claudeConfig.disabled) {
    console.log(chalk.dim('claude CLI: disabled via TKXR_CLAUDE_DISABLED (clipboard fallback active)'));
  } else if (claudeConfig.available) {
    console.log(chalk.dim(`claude CLI: ${claudeConfig.bin}${claudeConfig.version ? ` (v${claudeConfig.version})` : ''} · permission-mode=${claudeConfig.permissionMode}`));
  } else {
    console.log(chalk.dim('claude CLI: not found on PATH (clipboard fallback active)'));
  }

  // Ensure the process is running from the appropriate `dist` directory so relative
  // paths to `package.json` and the `web` assets resolve correctly.
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Candidate: dist directory in the project root and adjacent to this module when installed
    const projectDist = path.join(process.cwd(), 'dist');
    const moduleDist = path.join(__dirname, '..', '..', '..', 'dist');

    // Prefer the project's dist (development) first, fall back to module dist (installed)
    try {
      await fs.access(projectDist);
      process.chdir(projectDist);
      console.debug('Changed cwd to project dist:', projectDist);
    } catch (errProject) {
      try {
        await fs.access(moduleDist);
        process.chdir(moduleDist);
        console.debug('Changed cwd to module dist:', moduleDist);
      } catch (errModule) {
        // No dist found; continue using existing cwd
      }
    }
  } catch (err) {
    // Non-fatal; best effort only
    console.debug('Could not change cwd to dist:', err);
  }

  // Read version from package.json in current working directory first (so project dist is preferred)
  let version = '1.0.0'; // fallback
  try {
    const cwdPkg = path.join(process.cwd(), 'package.json');
    try {
      const pkgContent = await fs.readFile(cwdPkg, 'utf8');
      const pkg = JSON.parse(pkgContent);
      version = pkg.version || version;
    } catch (errCwdPkg) {
      // Fallback: attempt to read package.json relative to this module (installed package)
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const pkgPath = path.join(__dirname, '..', '..', '..', 'package.json');
        const pkgContent = await fs.readFile(pkgPath, 'utf8');
        const pkg = JSON.parse(pkgContent);
        version = pkg.version || version;
      } catch (error) {
        console.debug('Could not read package.json version from module or cwd:', error);
      }
    }
  } catch (error) {
    console.debug('Could not read package.json version:', error);
  }

  // Update notifier URL for this server instance
  const serverUrl = `http://${host}:${port}`;
  notifier.setServerUrl(serverUrl);
  
  // Save server config for other CLI commands (notifier) and the Vite dev server to use.
  // We standardize on `.tkxr-server` (JSON) so notifier + vite + serve all agree on one file.
  try {
    const configPath = path.join(process.cwd(), '.tkxr-server');
    const config = { host, port, url: serverUrl };
    await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  } catch (error) {
    // Don't fail if we can't write config
    console.debug('Could not save .tkxr-server config:', error);
  }

  // Middleware
  app.use(express.json({ limit: '2mb' })); // prompts can grow past the default 100kb
  // Serve static assets from the `web` folder inside `dist` (we may have chdir'd to dist)
  app.use(express.static(path.join(process.cwd(), 'web')));

  // Live runs: `runId` -> handle. Discovery already ran at boot (above) and
  // populated `app.locals.claude`; the run/cancel endpoints consume that
  // canonical config — no re-probing per request. See docs §3.
  const claudeRuns = new Map<string, ClaudeRun>();

  async function resolveClaudeCwd(requested: string | undefined): Promise<string> {
    const repoRoot = path.resolve(await getRepoRoot());
    if (!requested) return repoRoot;
    const normalized = path.resolve(requested);
    if (normalized === repoRoot) return repoRoot;
    const worktrees = await listWorktrees();
    const allowed = new Set(worktrees.map(w => path.resolve(w.path)));
    allowed.add(repoRoot);
    if (!allowed.has(normalized)) {
      throw Object.assign(new Error('bad_cwd'), { statusCode: 403, code: 'bad_cwd' });
    }
    return normalized;
  }

  // API Routes
  // GET /api/tickets
  //
  // Two response shapes for backwards compat (see tas-AEduZ-wc):
  //   1. No query params  -> returns `Ticket[]` (unchanged legacy shape).
  //      Callers: CLI `list` command, any external script that just wants
  //      "the whole list", plus older web builds during rollout.
  //   2. Any of the paging/filter params present -> returns
  //      `{ items: Ticket[], nextCursor: string|null, total: number }`.
  //      `total` is the *filtered* count so the toolbar "N shown" counter
  //      stays honest against the same filter set.
  //
  // Supported query params (all optional):
  //   limit    — page size, default 50, capped at 200
  //   cursor   — opaque base64url token from the previous page's `nextCursor`
  //   q        — case-insensitive substring against title + description + id
  //   sprint   — sprint id, the literal `none` for tickets with no sprint
  //   assignee — user id, the literal `none` for unassigned tickets
  //   type     — `task` | `bug`
  //   status   — single `TicketStatus` (used by board per-column paging later)
  //   sortBy   — `updated` (default) | `created` | `priority` | `title`
  //              Priority sort keeps the client's bug-over-task tiebreak.
  const PAGING_PARAM_KEYS = ['limit', 'cursor', 'q', 'sprint', 'assignee', 'type', 'status', 'sortBy'] as const;
  const VALID_SORT_BY = new Set<TicketSortBy>(['updated', 'created', 'priority', 'title']);
  const VALID_TYPES = new Set(['task', 'bug']);
  const VALID_STATUSES = new Set(['backlog', 'progress', 'review', 'blocked', 'done']);

  app.get('/api/tickets', async (req, res) => {
    try {
      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();

      const hasPagingParams = PAGING_PARAM_KEYS.some(k => typeof req.query[k] === 'string' && (req.query[k] as string).length > 0);
      if (!hasPagingParams) {
        // Legacy path: return the whole list untouched so the CLI list command
        // and any external scripts keep working with the pre-paging shape.
        const tickets = await storage.getAllTickets();
        return res.json(tickets);
      }

      const opts: TicketQueryOptions = {};
      if (typeof req.query.limit === 'string') {
        const n = Number(req.query.limit);
        if (!Number.isFinite(n) || n <= 0) {
          return res.status(400).json({ error: { code: 'bad_input', message: 'limit must be a positive number' } });
        }
        opts.limit = n;
      }
      if (typeof req.query.cursor === 'string' && req.query.cursor.length > 0) {
        opts.cursor = req.query.cursor;
      }
      if (typeof req.query.q === 'string' && req.query.q.length > 0) {
        opts.q = req.query.q;
      }
      if (typeof req.query.sprint === 'string' && req.query.sprint.length > 0) {
        opts.sprint = req.query.sprint;
      }
      if (typeof req.query.assignee === 'string' && req.query.assignee.length > 0) {
        opts.assignee = req.query.assignee;
      }
      if (typeof req.query.type === 'string' && req.query.type.length > 0) {
        if (!VALID_TYPES.has(req.query.type)) {
          return res.status(400).json({ error: { code: 'bad_input', message: 'type must be task or bug' } });
        }
        opts.type = req.query.type as any;
      }
      if (typeof req.query.status === 'string' && req.query.status.length > 0) {
        if (!VALID_STATUSES.has(req.query.status)) {
          return res.status(400).json({ error: { code: 'bad_input', message: `status must be one of ${[...VALID_STATUSES].join(', ')}` } });
        }
        opts.status = req.query.status as any;
      }
      if (typeof req.query.sortBy === 'string' && req.query.sortBy.length > 0) {
        if (!VALID_SORT_BY.has(req.query.sortBy as TicketSortBy)) {
          return res.status(400).json({ error: { code: 'bad_input', message: `sortBy must be one of ${[...VALID_SORT_BY].join(', ')}` } });
        }
        opts.sortBy = req.query.sortBy as TicketSortBy;
      }

      const result = await storage.queryTickets(opts);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load tickets' });
    }
  });

  // Aggregate counts for sidebar badges, triage pill, and Board column badges.
  // Cheap single-pass over `getAllTickets()` — no new storage plumbing. Clients
  // refetch this on any `ticket_*` WS event; the handler broadcasts nothing.
  // Registered BEFORE `/api/tickets/:type` so Express doesn't route `summary`
  // into the type handler (which only accepts 'task' | 'bug').
  // See tas-4MNJ9qP5.
  app.get('/api/tickets/summary', async (req, res) => {
    try {
      // Reload from disk so we agree with whatever `/api/tickets` last read.
      await storage.loadProject();
      const tickets = await storage.getAllTickets();

      const byStatus: Record<'backlog' | 'progress' | 'review' | 'blocked' | 'done', number> = {
        backlog: 0,
        progress: 0,
        review: 0,
        blocked: 0,
        done: 0,
      };
      let unassignedOpen = 0;
      let criticalOpen = 0;

      for (const t of tickets) {
        // Defensive: unknown statuses just don't get counted in byStatus.
        if (t.status in byStatus) {
          byStatus[t.status as keyof typeof byStatus]++;
        }
        const isOpen = t.status !== 'done';
        if (isOpen && !t.assignee) unassignedOpen++;
        if (isOpen && t.priority === 'critical') criticalOpen++;
      }

      const total = tickets.length;
      const counts = { ...byStatus, total };
      const triage = {
        unassignedOpen,
        criticalOpen,
        backlogCount: byStatus.backlog,
      };

      res.json({ counts, triage, byStatus });
    } catch (error) {
      res.status(500).json({ error: 'Failed to load ticket summary' });
    }
  });

  app.get('/api/tickets/:type', async (req, res) => {
    try {
      const { type } = req.params;
      if (type !== 'task' && type !== 'bug') {
        return res.status(400).json({ error: 'Invalid ticket type' });
      }
      const tickets = await storage.getTicketsByType(type);
      res.json(tickets);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load tickets' });
    }
  });

  app.get('/api/sprints', async (req, res) => {
    try {      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();      const sprints = await storage.getSprints();
      res.json(sprints);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load sprints' });
    }
  });

  app.get('/api/users', async (req, res) => {
    try {      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();      const users = await storage.getUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load users' });
    }
  });

  // Serve server configuration for dynamic client discovery.
  // NOTE: the `claude` sub-object is populated here as a courtesy so the runner
  // ticket (tas-5j83ACCR) doesn't leave the field undefined. The config ticket
  // (tas-6XZPfKnY) is the canonical owner of this payload shape and may extend it.
  app.get('/api/config', async (req, res) => {
    try {
      // `claude` block populated once at boot from `discoverClaude()` (§2 of
      // docs/claude-cli-integration.md). Web store `claudeConfig` reads this
      // to decide between "Run in Claude" and the existing "Copy prompt" flow.
      const cached: ClaudeConfig = app.locals.claude ?? { available: false, bin: '' };
      res.json({
        host: 'localhost',
        port: port,
        url: `http://localhost:${port}`,
        version: version,
        claude: toPublicConfig(cached),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to get server config' });
    }
  });

  app.post('/api/tickets', async (req, res) => {
    try {
      const { type, title, ...options } = req.body;
      
      if (!type || !title) {
        return res.status(400).json({ error: 'Type and title are required' });
      }
      
      if (type !== 'task' && type !== 'bug') {
        return res.status(400).json({ error: 'Invalid ticket type' });
      }

      const ticket = await storage.createTicket(type, title, options);
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_created', 
        data: ticket 
      });
      
      res.json(ticket);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create ticket' });
    }
  });

  app.put('/api/tickets/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Update ticket using the simplified interface
      const updatedTicket = await storage.updateTicket(id, updates);

      if (!updatedTicket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_updated', 
        data: updatedTicket 
      });
      
      res.json(updatedTicket);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update ticket' });
    }
  });

  app.delete('/api/tickets/:id', async (req, res) => {
    try {
      const { id } = req.params;
      
      // First, delete all comments associated with this ticket
      const comments = await storage.getComments(id);
      for (const comment of comments) {
        await storage.deleteComment(comment.id);
      }
      
      // Try to delete from tasks first, then bugs
      let deleted = await storage.deleteEntity('tasks', id);
      if (!deleted) {
        deleted = await storage.deleteEntity('bugs', id);
      }

      if (!deleted) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_deleted', 
        data: { id } 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete ticket' });
    }
  });

  app.post('/api/users', async (req, res) => {
    try {
      const { username, displayName, email, color } = req.body;

      if (!username || !displayName) {
        return res.status(400).json({ error: 'Username and display name are required' });
      }

      const user = await storage.createUser(username, displayName, { email, color });

      broadcast(wss, { type: 'user_created', data: user });

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create user' });
    }
  });

  app.delete('/api/users/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { deleted, unassignedTickets } = await storage.deleteUser(id);

      if (!deleted) {
        return res.status(404).json({ error: 'User not found' });
      }

      broadcast(wss, { type: 'user_deleted', data: { id } });
      for (const t of unassignedTickets) {
        broadcast(wss, { type: 'ticket_updated', data: t });
      }

      res.json({ success: true, unassignedTicketIds: unassignedTickets.map(t => t.id) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // Comments API
  // Aggregate comment counts for every ticket. Used by the board so
  // BoardCard's comment badge lights up without one fetch per ticket.
  app.get('/api/comments/counts', async (req, res) => {
    try {
      await storage.loadProject();
      const counts = await storage.getCommentCounts();
      res.json(counts);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load comment counts' });
    }
  });

  app.get('/api/tickets/:ticketId/comments', async (req, res) => {
    try {
      // Reload data from disk to ensure we have the latest changes
      await storage.loadProject();
      const { ticketId } = req.params;
      const comments = await storage.getComments(ticketId);
      res.json(comments);
    } catch (error) {
      res.status(500).json({ error: 'Failed to load comments' });
    }
  });

  app.post('/api/tickets/:ticketId/comments', async (req, res) => {
    try {
      const { ticketId } = req.params;
      const { content, author } = req.body;
      
      if (!content || !content.trim()) {
        return res.status(400).json({ error: 'Comment content is required' });
      }

      if (!author) {
        return res.status(400).json({ error: 'Comment author is required' });
      }

      const comment = await storage.createComment(ticketId, author, content.trim());
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_created', 
        data: comment 
      });
      
      res.json(comment);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create comment' });
    }
  });

  app.delete('/api/comments/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteComment(id);

      if (!deleted) {
        return res.status(404).json({ error: 'Comment not found' });
      }

      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_deleted', 
        data: { id } 
      });

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete comment' });
    }
  });

  app.post('/api/sprints', async (req, res) => {
    try {
      const { name, description, goal, status, startDate, endDate } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Sprint name is required' });
      }

      const opts: any = { description, goal };
      if (status && ['planning', 'active', 'completed'].includes(status)) opts.status = status;
      if (startDate) opts.startDate = new Date(startDate);
      if (endDate) opts.endDate = new Date(endDate);

      const sprint = await storage.createSprint(name, opts);

      broadcast(wss, { type: 'sprint_created', data: sprint });

      res.json(sprint);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create sprint' });
    }
  });

  app.delete('/api/sprints/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { ok, sweptTickets } = await storage.deleteSprint(id);

      if (!ok) {
        return res.status(404).json({ error: 'Sprint not found' });
      }

      broadcast(wss, { type: 'sprint_deleted', data: { id } });
      for (const t of sweptTickets) {
        broadcast(wss, { type: 'ticket_updated', data: t });
      }

      res.json({ success: true, sweptTicketIds: sweptTickets.map(t => t.id) });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete sprint' });
    }
  });

  app.put('/api/sprints/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description, goal, status, startDate, endDate } = req.body;

      const updates: any = {};
      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (goal !== undefined) updates.goal = goal;
      if (status && ['planning', 'active', 'completed'].includes(status)) updates.status = status;
      if (startDate !== undefined) updates.startDate = startDate ? new Date(startDate) : undefined;
      if (endDate !== undefined) updates.endDate = endDate ? new Date(endDate) : undefined;

      const sprint = await storage.updateSprint(id, updates);

      if (!sprint) {
        return res.status(404).json({ error: 'Sprint not found' });
      }

      broadcast(wss, { type: 'sprint_updated', data: sprint });

      res.json(sprint);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update sprint' });
    }
  });

  app.put('/api/users/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { username, displayName, email, color } = req.body;

      const updates: any = {};
      if (username !== undefined) updates.username = username;
      if (displayName !== undefined) updates.displayName = displayName;
      if (email !== undefined) updates.email = email;
      if (color !== undefined) updates.color = color;

      const user = await storage.updateUser(id, updates);

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      broadcast(wss, { type: 'user_updated', data: user });

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update user' });
    }
  });
  app.put('/api/sprints/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      if (!['planning', 'active', 'completed'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be planning, active, or completed' });
      }

      const sprint = await storage.updateSprintStatus(id, status);
      
      if (!sprint) {
        return res.status(404).json({ error: 'Sprint not found' });
      }

      res.json(sprint);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update sprint status' });
    }
  });

  app.put('/api/tickets/:id/status', async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      const validStatuses = ['backlog', 'progress', 'review', 'blocked', 'done'];
      if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: `Status must be one of ${validStatuses.join(', ')}` });
      }

      const ticket = await storage.updateTicketStatus(id, status);
      
      if (!ticket) {
        return res.status(404).json({ error: 'Ticket not found' });
      }

      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_updated', 
        data: ticket 
      });
      
      res.json(ticket);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update ticket' });
    }
  });

  // CLI Notification endpoints - allow CLI to notify web server of changes
  app.post('/api/cli-notifications/ticket-created', async (req, res) => {
    try {
      const ticket = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_created', 
        data: ticket 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/ticket-updated', async (req, res) => {
    try {
      const ticket = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_updated', 
        data: ticket 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/ticket-deleted', async (req, res) => {
    try {
      const { id } = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'ticket_deleted', 
        data: { id } 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/sprint-created', async (req, res) => {
    try {
      const sprint = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'sprint_created', 
        data: sprint 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/sprint-updated', async (req, res) => {
    try {
      const sprint = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'sprint_updated', 
        data: sprint 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/user-created', async (req, res) => {
    try {
      const user = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'user_created', 
        data: user 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/comment-created', async (req, res) => {
    try {
      const comment = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_created', 
        data: comment 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  app.post('/api/cli-notifications/comment-deleted', async (req, res) => {
    try {
      const { id, ticketId } = req.body;
      
      // Broadcast to WebSocket clients
      broadcast(wss, { 
        type: 'comment_deleted', 
        data: { id, ticketId } 
      });
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: 'Failed to process notification' });
    }
  });

  // -------------------- MCP over HTTP --------------------
  // Same tool implementations as the stdio bin (src/mcp/server.ts). Agents can either:
  //   - Use the stdio bin `tkxr-mcp` (per existing MCP client configs), or
  //   - POST/GET MCP JSON-RPC to /mcp on this server.
  const mcpCtx: ToolContext = {
    storage,
    broadcast: (ev) => broadcast(wss, { type: ev.type, data: ev.data }),
  };

  function createMcpServer(): McpServer {
    const s = new McpServer(
      { name: 'tkxr-mcp', version },
      { capabilities: { tools: {} }, instructions: SERVER_INSTRUCTIONS },
    );
    s.setRequestHandler(InitializeRequestSchema, async () => ({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'tkxr-mcp', version },
      instructions: SERVER_INSTRUCTIONS,
    }));
    s.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    }));
    s.setRequestHandler(CallToolRequestSchema, async (request): Promise<any> => {
      const { name, arguments: args } = request.params;
      const tool = TOOL_MAP[name];
      if (!tool) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      try {
        return await tool.handler(args || {}, mcpCtx);
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    });
    return s;
  }

  // Session map for stateful HTTP transports (one transport per session id).
  const mcpTransports = new Map<string, StreamableHTTPServerTransport>();

  async function handleMcp(req: express.Request, res: express.Response) {
    const sessionId = (req.headers['mcp-session-id'] as string | undefined) || undefined;
    let transport = sessionId ? mcpTransports.get(sessionId) : undefined;

    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => { mcpTransports.set(sid, transport!); },
      });
      transport.onclose = () => {
        if (transport!.sessionId) mcpTransports.delete(transport!.sessionId);
      };
      await createMcpServer().connect(transport);
    }

    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'mcp_error', message: error instanceof Error ? error.message : 'MCP error' } });
      }
    }
  }

  app.post('/mcp', handleMcp);
  app.get('/mcp', handleMcp);
  app.delete('/mcp', handleMcp);

  // Convenience: expose the tool list + agent guide as plain REST for humans and simple clients.
  app.get('/api/mcp/tools', (req, res) => {
    res.json({
      instructions: SERVER_INSTRUCTIONS,
      tools: TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
  });
  app.get('/api/mcp/guide', (req, res) => {
    const guideTool = TOOL_MAP['agent_guide'];
    guideTool.handler({}, mcpCtx)
      .then(r => res.type('text/markdown').send(r.content[0].text))
      .catch(err => res.status(500).json({ error: String(err) }));
  });

  // -------------------- Worktree REST endpoints --------------------
  // Web UI convenience; MCP tools cover the same ground for agents.
  app.get('/api/worktrees', async (req, res) => {
    try {
      if (!(await isGitRepo())) return res.status(400).json({ error: 'Not a git repository' });
      const worktrees = await listWorktrees();
      res.json({ worktrees, isGitRepo: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to list worktrees' });
    }
  });

  app.post('/api/tickets/:id/worktree', async (req, res) => {
    try {
      const { id } = req.params;
      const found = await storage.findTicket(id);
      if (!found) return res.status(404).json({ error: 'Ticket not found' });
      if (found.ticket.worktree) {
        return res.status(409).json({ error: `Ticket already has a worktree at ${found.ticket.worktree.path}` });
      }
      if (!(await isGitRepo())) return res.status(400).json({ error: 'Not a git repository' });
      const { path: p, branch, base } = req.body || {};
      let effectiveBase = base;
      if (!effectiveBase && found.ticket.sprint) {
        const sprint = (await storage.getSprints()).find(s => s.id === found.ticket.sprint);
        if (sprint?.worktree) effectiveBase = sprint.worktree.branch;
      }
      const result = await createWorktree({ ticketId: id, path: p, branch, base: effectiveBase });
      const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
      const updated = await storage.updateTicket(id, { worktree: wt });
      if (updated) broadcast(wss, { type: 'ticket_updated', data: updated });
      res.json({ ticket: updated, worktree: wt, basedOn: effectiveBase || 'HEAD' });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create worktree' });
    }
  });

  app.post('/api/sprints/:id/worktree', async (req, res) => {
    try {
      const { id } = req.params;
      const sprint = (await storage.getSprints()).find(s => s.id === id);
      if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
      if (sprint.worktree) {
        return res.status(409).json({ error: `Sprint already has a worktree at ${sprint.worktree.path}` });
      }
      if (!(await isGitRepo())) return res.status(400).json({ error: 'Not a git repository' });
      const { path: p, branch, base } = req.body || {};
      const result = await createSprintWorktree({ sprintId: id, path: p, branch, base });
      const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
      const updated = await storage.updateSprint(id, { worktree: wt });
      if (updated) broadcast(wss, { type: 'sprint_updated', data: updated });
      res.json({ sprint: updated, worktree: wt });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create sprint worktree' });
    }
  });

  app.delete('/api/sprints/:id/worktree', async (req, res) => {
    try {
      const { id } = req.params;
      const sprint = (await storage.getSprints()).find(s => s.id === id);
      if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
      const wt = sprint.worktree;
      if (!wt) return res.status(404).json({ error: 'Sprint has no worktree' });
      const force = req.query.force === 'true' || req.body?.force === true;
      const keepBranch = req.query.keepBranch === 'true' || req.body?.keepBranch === true;
      await removeWorktree({ path: wt.path, branch: wt.branch, force, keepBranch });
      const updated = await storage.updateSprint(id, { worktree: null });
      if (updated) broadcast(wss, { type: 'sprint_updated', data: updated });
      res.json({ sprint: updated, removed: wt });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to remove sprint worktree' });
    }
  });

  app.delete('/api/tickets/:id/worktree', async (req, res) => {
    try {
      const { id } = req.params;
      const found = await storage.findTicket(id);
      if (!found) return res.status(404).json({ error: 'Ticket not found' });
      const wt = found.ticket.worktree;
      if (!wt) return res.status(404).json({ error: 'Ticket has no worktree' });
      const force = req.query.force === 'true' || req.body?.force === true;
      const keepBranch = req.query.keepBranch === 'true' || req.body?.keepBranch === true;
      await removeWorktree({ path: wt.path, branch: wt.branch, force, keepBranch });
      const updated = await storage.updateTicket(id, { worktree: null });
      if (updated) broadcast(wss, { type: 'ticket_updated', data: updated });
      res.json({ ticket: updated, removed: wt });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to remove worktree' });
    }
  });

  // -------------------- Git insights (read-only) --------------------
  // Surfaces branch state for tickets / sprints so the UI can show commits
  // that live in per-ticket / per-sprint worktrees (invisible from the user's
  // primary VSCode window). Never mutates git state.

  app.get('/api/git/remote', async (req, res) => {
    try {
      const info = await getRemoteInfo();
      res.json({ remote: info });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read remote' });
    }
  });

  app.get('/api/tickets/:id/git', async (req, res) => {
    try {
      const { id } = req.params;
      const found = await storage.findTicket(id);
      if (!found) return res.status(404).json({ error: 'Ticket not found' });
      const wt = found.ticket.worktree;
      if (!wt) return res.status(409).json({ error: 'Ticket has no worktree' });

      // Prefer the sprint branch as base when the ticket is in a sprint that
      // has its own worktree. Otherwise fall back to the repo default (main).
      let base: string | undefined;
      if (found.ticket.sprint) {
        const sprint = (await storage.getSprints()).find(s => s.id === found.ticket.sprint);
        if (sprint?.worktree) base = sprint.worktree.branch;
      }

      const remote = await getRemoteInfo();
      const insights = await getBranchInsights({
        cwd: wt.path,
        branch: wt.branch,
        base,
        remote,
      });
      res.json({ insights, remote });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read branch insights' });
    }
  });

  app.get('/api/sprints/:id/git', async (req, res) => {
    try {
      const { id } = req.params;
      const sprint = (await storage.getSprints()).find(s => s.id === id);
      if (!sprint) return res.status(404).json({ error: 'Sprint not found' });
      const wt = sprint.worktree;
      if (!wt) return res.status(409).json({ error: 'Sprint has no worktree' });

      const remote = await getRemoteInfo();
      const insights = await getBranchInsights({
        cwd: wt.path,
        branch: wt.branch,
        remote,
      });
      res.json({ insights, remote });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read branch insights' });
    }
  });

  // AI endpoints (stubs — return deterministic scaffolding until wired to a model)
  const AI_UNAVAILABLE = 'AI backend not configured. This is a stub response.';

  app.post('/api/ai/ask', async (req, res) => {
    try {
      const { ticketId, prompt } = req.body || {};
      if (!ticketId || !prompt) {
        return res.status(400).json({ error: { code: 'bad_input', message: 'ticketId and prompt required' } });
      }
      const found = await storage.findTicket(ticketId);
      if (!found) {
        return res.status(404).json({ error: { code: 'not_found', message: 'Ticket not found' } });
      }
      const t = found.ticket;
      const answer = `${AI_UNAVAILABLE}\n\nContext: ${t.type} ${t.id} "${t.title}" (status=${t.status}, priority=${t.priority || 'none'}, estimate=${t.estimate ?? '—'}).\n\nYou asked: ${prompt}`;
      res.json({ answer });
    } catch (error) {
      res.status(503).json({ error: { code: 'ai_unavailable', message: 'AI service unavailable' } });
    }
  });

  function parseNL(text: string, users: any[]) {
    const t = text.toLowerCase();
    const type: 'task' | 'bug' = /\b(bug|error|crash|fail|broken)\b/.test(t) ? 'bug' : 'task';
    let priority: 'low' | 'medium' | 'high' | 'critical' = 'medium';
    if (/\bcritical\b/.test(t)) priority = 'critical';
    else if (/\bhigh\b|\burgent\b/.test(t)) priority = 'high';
    else if (/\blow\b|\bminor\b/.test(t)) priority = 'low';
    let assignee: string | null = null;
    for (const u of users) {
      const name = (u.displayName || '').toLowerCase();
      const uname = (u.username || '').toLowerCase();
      if (name && t.includes(name.split(' ')[0])) { assignee = u.id; break; }
      if (uname && t.includes('@' + uname)) { assignee = u.id; break; }
      if (uname && t.includes(uname)) { assignee = u.id; break; }
    }
    let title = text.replace(/\b(critical|high|urgent|low|minor|bug|task)\b:?/gi, '').trim();
    title = title.replace(/\s+/g, ' ').replace(/^[:\-\s]+/, '');
    if (title) title = title[0].toUpperCase() + title.slice(1);
    return { type, priority, assignee, title };
  }

  app.post('/api/ai/create', async (req, res) => {
    try {
      const { text, commit, defaults } = req.body || {};
      if (!text || typeof text !== 'string' || text.trim().length < 2) {
        return res.status(400).json({ error: { code: 'bad_input', message: 'text required' } });
      }
      const users = await storage.getUsers();
      const parsed = parseNL(text, users);
      const draft = {
        type: parsed.type,
        title: parsed.title || text.trim(),
        priority: parsed.priority,
        assignee: parsed.assignee,
        sprint: (defaults && defaults.sprint) || null,
        estimate: null as number | null,
      };
      if (!commit) return res.json({ draft });
      const ticket = await storage.createTicket(draft.type, draft.title, {
        priority: draft.priority,
        assignee: draft.assignee || undefined,
        sprint: draft.sprint || undefined,
      });
      broadcast(wss, { type: 'ticket_created', data: ticket });
      res.json({ draft, ticket });
    } catch (error) {
      res.status(503).json({ error: { code: 'ai_unavailable', message: 'AI service unavailable' } });
    }
  });

  app.post('/api/ai/triage', async (req, res) => {
    try {
      const { scope } = req.body || {};
      const all = await storage.getAllTickets();
      const inScope = all.filter(t => {
        if (t.status === 'done') return false;
        if (scope && scope.sprint && t.sprint !== scope.sprint) return false;
        if (scope && scope.assignee && t.assignee !== scope.assignee) return false;
        return true;
      });
      const items: any[] = [];
      const unassigned = inScope.filter(t => !t.assignee);
      if (unassigned.length > 0) {
        items.push({
          id: 'unassigned',
          severity: 'warn',
          title: `${unassigned.length} open ticket${unassigned.length === 1 ? '' : 's'} have no owner`,
          detail: unassigned.slice(0, 4).map(t => t.id).join(', ') + (unassigned.length > 4 ? '…' : ''),
          action: { kind: 'filter', params: { assignee: 'none', view: 'list' } },
        });
      }
      const criticals = inScope.filter(t => t.priority === 'critical');
      if (criticals.length > 0) {
        items.push({
          id: 'criticals',
          severity: 'high',
          title: `${criticals.length} critical ticket${criticals.length === 1 ? '' : 's'} still open`,
          detail: criticals.slice(0, 2).map(t => t.title).join(' · '),
          action: { kind: 'filter', params: { type: null } },
        });
      }
      const stale = inScope.filter(t => t.status === 'progress' && (Date.now() - new Date(t.updatedAt).getTime()) > 7 * 24 * 60 * 60 * 1000);
      if (stale.length > 0) {
        items.push({
          id: 'stale',
          severity: 'info',
          title: `${stale.length} in-progress ticket${stale.length === 1 ? '' : 's'} untouched > 7 days`,
          detail: stale.slice(0, 3).map(t => t.id).join(', '),
          action: { kind: 'filter', params: { view: 'list' } },
        });
      }
      const backlog = inScope.filter(t => t.status === 'backlog');
      if (backlog.length >= 4) {
        items.push({
          id: 'draft_sprint',
          severity: 'info',
          title: `Draft the next sprint (${backlog.length} backlog tickets)`,
          detail: 'Auto-balance a planning sprint from the backlog.',
          action: { kind: 'draft_sprint', params: {} },
        });
      }
      res.json({
        summary: `Scanned ${inScope.length} open tickets. ${items.length} finding${items.length === 1 ? '' : 's'}.`,
        items,
      });
    } catch (error) {
      res.status(503).json({ error: { code: 'ai_unavailable', message: 'AI service unavailable' } });
    }
  });

  app.post('/api/ai/plan', async (req, res) => {
    try {
      const { capacity, commit } = req.body || {};
      const all = await storage.getAllTickets();
      const backlog = all.filter(t => t.status === 'backlog' && !t.sprint);
      const totalPts = backlog.reduce((sum, t) => sum + (t.estimate || 0), 0);
      const cap = Math.max(8, Math.round(capacity ?? totalPts / 2));
      const priOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const sorted = [...backlog].sort((a, b) => (priOrder[a.priority || 'medium'] - priOrder[b.priority || 'medium']));
      const selected: any[] = [];
      let acc = 0;
      for (const t of sorted) {
        const pts = t.estimate || 0;
        if (acc + pts <= cap) { selected.push(t); acc += pts; }
      }
      const sprints = await storage.getSprints();
      const planningCount = sprints.filter(s => s.status === 'planning').length + 1;
      const plan = {
        name: `Planned Sprint ${planningCount}`,
        goal: `Auto-balanced to ~${cap} pts · ${selected.length} of ${backlog.length} backlog tickets (${acc} pts)`,
        capacity: cap,
        selectedPoints: acc,
        ticketIds: selected.map(t => t.id),
      };
      if (!commit) return res.json({ plan });
      const sprint = await storage.createSprint(plan.name, { goal: plan.goal, status: 'planning' });
      broadcast(wss, { type: 'sprint_created', data: sprint });
      for (const t of selected) {
        const updated = await storage.updateTicket(t.id, { sprint: sprint.id });
        if (updated) broadcast(wss, { type: 'ticket_updated', data: updated });
      }
      res.json({ plan, sprint });
    } catch (error) {
      res.status(503).json({ error: { code: 'ai_unavailable', message: 'AI service unavailable' } });
    }
  });

  // -------------------- Claude CLI: run + cancel --------------------
  // POST /api/claude/run  body: { prompt, cwd?, runId?, label? }
  //   - Validates cwd against getRepoRoot() + listWorktrees() (workspace-escape defense).
  //   - Spawns `claude -p --output-format stream-json --verbose`, prompt on stdin.
  //   - Streams stdout frames as `claude_run_chunk` events over the shared WS.
  //   - 503 { code: 'claude_unavailable' } when the binary is missing.
  // POST /api/claude/cancel  body: { runId } -> SIGTERM (SIGKILL after 2s grace).
  //
  // Event shapes (see docs §3):
  //   claude_run_started { runId, cwd, label, startedAt }
  //   claude_run_chunk   { runId, stream: 'stdout'|'stderr', frame }
  //   claude_run_exit    { runId, ok, exitCode, signal, durationMs, costUsd?, isError? }

  app.post('/api/claude/run', async (req, res) => {
    // Read the canonical Claude config populated at boot by tas-6XZPfKnY. Never
    // re-probe here — spawn errors below flip availability if the binary vanished.
    const claude: ClaudeConfig = app.locals.claude ?? { available: false, bin: '' };
    if (!claude.available) {
      return res.status(503).json({ error: { code: 'claude_unavailable', message: 'claude CLI not found on server' } });
    }

    const { prompt, cwd: rawCwd, runId: rawRunId, label } = req.body || {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return res.status(400).json({ error: { code: 'bad_input', message: 'prompt required' } });
    }
    if (rawCwd !== undefined && typeof rawCwd !== 'string') {
      return res.status(400).json({ error: { code: 'bad_input', message: 'cwd must be a string' } });
    }
    if (rawRunId !== undefined && typeof rawRunId !== 'string') {
      return res.status(400).json({ error: { code: 'bad_input', message: 'runId must be a string' } });
    }

    let cwd: string;
    try {
      cwd = await resolveClaudeCwd(rawCwd);
    } catch (error: any) {
      if (error?.code === 'bad_cwd') {
        return res.status(403).json({ error: { code: 'bad_cwd', message: 'cwd must be the repo root or a registered worktree path' } });
      }
      return res.status(500).json({ error: { code: 'cwd_resolve_failed', message: error?.message || 'failed to resolve cwd' } });
    }

    const runId = rawRunId || randomUUID();
    if (claudeRuns.has(runId)) {
      return res.status(409).json({ error: { code: 'run_exists', message: `runId ${runId} already active` } });
    }

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawnClaude({
        prompt,
        cwd,
        bin: claude.bin,
        // Use the pre-parsed extraArgs from discovery when present; the config
        // ticket already tokenized TKXR_CLAUDE_ARGS at boot.
        extraArgs: claude.extraArgs,
        permissionMode: claude.permissionMode,
      });
    } catch (error: any) {
      // Binary went missing between discovery and now — flip availability and 503.
      if (error?.code === 'ENOENT') {
        const disabled: ClaudeConfig = { ...claude, available: false };
        app.locals.claude = disabled;
        return res.status(503).json({ error: { code: 'claude_unavailable', message: 'claude binary vanished after boot' } });
      }
      return res.status(500).json({ error: { code: 'spawn_failed', message: error?.message || 'spawn failed' } });
    }

    const startedAt = Date.now();
    const run: ClaudeRun = {
      runId,
      child,
      frames: [],
      stderrBuf: [],
      startedAt,
      cwd,
      label: typeof label === 'string' ? label : undefined,
      stdoutBuf: '',
    };
    claudeRuns.set(runId, run);

    broadcast(wss, {
      type: 'claude_run_started',
      data: { runId, cwd, label: run.label, startedAt },
    });

    // Parse JSONL frames on stdout. Each non-empty line is a stream-json event.
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      run.stdoutBuf += chunk;
      let idx: number;
      while ((idx = run.stdoutBuf.indexOf('\n')) >= 0) {
        const line = run.stdoutBuf.slice(0, idx).replace(/\r$/, '');
        run.stdoutBuf = run.stdoutBuf.slice(idx + 1);
        if (!line.trim()) continue;
        let frame: any;
        try {
          frame = JSON.parse(line);
        } catch {
          // Non-JSON line — forward raw so clients can surface it as-is.
          frame = { type: 'raw', line };
        }
        run.frames.push(frame);
        broadcast(wss, { type: 'claude_run_chunk', data: { runId, stream: 'stdout', frame } });
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      run.stderrBuf.push(chunk);
      broadcast(wss, {
        type: 'claude_run_chunk',
        data: { runId, stream: 'stderr', frame: { type: 'stderr', text: chunk } },
      });
    });

    child.on('error', (err) => {
      // Deliver as a synthetic chunk so late-subscribers see it in the frame log.
      broadcast(wss, {
        type: 'claude_run_chunk',
        data: { runId, stream: 'stderr', frame: { type: 'spawn_error', message: String(err?.message || err) } },
      });
    });

    child.on('exit', (code, signal) => {
      // Flush any trailing partial line as a raw frame.
      const tail = run.stdoutBuf.trim();
      if (tail) {
        let frame: any;
        try { frame = JSON.parse(tail); } catch { frame = { type: 'raw', line: tail }; }
        run.frames.push(frame);
        broadcast(wss, { type: 'claude_run_chunk', data: { runId, stream: 'stdout', frame } });
      }
      run.stdoutBuf = '';

      const durationMs = Date.now() - startedAt;
      // Pull cost + is_error off the terminal `result` frame if the CLI produced one.
      const resultFrame = [...run.frames].reverse().find(f => f?.type === 'result');
      const costUsd = typeof resultFrame?.total_cost_usd === 'number' ? resultFrame.total_cost_usd : undefined;
      const isError = resultFrame?.is_error === true;

      const cancelled = signal === 'SIGTERM' || signal === 'SIGKILL';
      const ok = !cancelled && code === 0 && !isError;

      broadcast(wss, {
        type: 'claude_run_exit',
        data: {
          runId,
          ok,
          exitCode: code,
          signal,
          durationMs,
          costUsd,
          isError,
          cancelled,
          stderr: ok ? undefined : run.stderrBuf.join(''),
        },
      });

      // Retain the run briefly so late-joining tabs can query state; then drop.
      setTimeout(() => { claudeRuns.delete(runId); }, 30_000).unref?.();
    });

    res.json({ runId });
  });

  app.post('/api/claude/cancel', (req, res) => {
    const { runId } = req.body || {};
    if (!runId || typeof runId !== 'string') {
      return res.status(400).json({ error: { code: 'bad_input', message: 'runId required' } });
    }
    const run = claudeRuns.get(runId);
    if (!run) {
      return res.status(404).json({ error: { code: 'not_found', message: `no active run ${runId}` } });
    }
    killWithGrace(run.child);
    res.json({ cancelled: true, runId });
  });

  // Serve web app for all other routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'web', 'index.html'));
  });

  // WebSocket connection handling
  wss.on('connection', (ws) => {
    console.log(chalk.dim('WebSocket client connected'));
    
    ws.on('close', () => {
      console.log(chalk.dim('WebSocket client disconnected'));
    });
  });

  // Start server
  const onListenError = (err: any) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(chalk.red(`Port ${port} is already in use.`));
      console.error(chalk.dim(`Try: tkxr serve --port <another-port>  (or set TKXR_PORT / PORT)`));
      process.exit(1);
    }
    console.error(chalk.red('Server error:'), err);
    process.exit(1);
  };
  server.on('error', onListenError);
  // WebSocketServer re-emits the underlying server's error; must be handled to avoid an uncaught 'error' event.
  wss.on('error', onListenError);
  server.listen(port, host, () => {
    console.log(chalk.green('🚀 tkxr server started'));
    console.log(`   Local:   http://${host}:${port}`);
    console.log(`   API:     http://${host}:${port}/api`);
    console.log(`   MCP:     http://${host}:${port}/mcp`);
    console.log();
    console.log(chalk.dim('Press Ctrl+C to stop'));
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n⏹️  Shutting down server...'));

    // Kill any live Claude runs so we don't orphan child processes.
    for (const run of claudeRuns.values()) {
      try { killWithGrace(run.child); } catch { /* noop */ }
    }

    // Clean up server config file
    try {
      const configPath = path.join(process.cwd(), '.tkxr-server');
      unlinkSync(configPath);
    } catch (error) {
      // Ignore cleanup errors
    }

    server.close(() => {
      console.log(chalk.green('Server stopped'));
      process.exit(0);
    });
  });
}

function broadcast(wss: WebSocketServer, message: any): void {
  const data = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  });
}