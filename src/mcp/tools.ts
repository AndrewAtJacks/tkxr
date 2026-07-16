import type { ProjectStorage } from '../core/storage.js';
import type { Sprint, Ticket, TicketStatus, User } from '../core/types.js';
import { createSprintWorktree, createWorktree, isGitRepo, listWorktrees, removeWorktree } from '../core/worktree.js';

export type BroadcastEvent =
  | { type: 'ticket_created' | 'ticket_updated' | 'ticket_deleted' | 'sprint_created' | 'sprint_updated' | 'sprint_deleted' | 'user_created' | 'user_updated' | 'user_deleted' | 'comment_created' | 'comment_deleted'; data: any };

export interface ToolContext {
  storage: ProjectStorage;
  broadcast?: (ev: BroadcastEvent) => void;
}

export interface ToolResultContent {
  type: 'text';
  text: string;
}
export interface ToolResult {
  content: ToolResultContent[];
  isError?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: any;
  handler: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

const STATUSES = ['backlog', 'progress', 'review', 'blocked', 'done'] as const;
const SPRINT_STATUSES = ['planning', 'active', 'completed'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

function jsonResult(payload: any): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
}
function textResult(text: string, isError = false): ToolResult {
  return { content: [{ type: 'text', text }], isError };
}
function errorResult(message: string): ToolResult {
  return textResult(`Error: ${message}`, true);
}

async function resolveUserId(storage: ProjectStorage, ref: string): Promise<string | null> {
  if (!ref) return null;
  const users = await storage.getUsers();
  const byId = users.find(u => u.id === ref);
  if (byId) return byId.id;
  const byUsername = users.find(u => u.username === ref || u.username === ref.replace(/^@/, ''));
  return byUsername?.id || null;
}

export const AGENT_GUIDE = `# tkxr — Agent Guide

tkxr is an in-repo ticket manager. Data is stored under \`./tkxr/\` in the working directory
(NDJSON for tickets/comments, JSON for sprints/users). Use this MCP server to inspect and
mutate the project state without shelling out.

## Data model
- **Ticket**: id (\`tas-*\` for tasks, \`bug-*\` for bugs), title, description,
  status ∈ {backlog, progress, review, blocked, done}, priority ∈ {low, medium, high, critical},
  estimate (story points), assignee (User id), sprint (Sprint id), labels[].
- **Sprint**: id (\`spr-*\`), name, description, goal, status ∈ {planning, active, completed},
  startDate, endDate.
- **User**: id (\`use-*\`), username, displayName, email, color.
- **Comment**: id, ticketId, author (User id), content.

## Typical flow
1. \`list_users\` → cache users so you can resolve @handles → ids.
2. \`list_sprints\` → find the active sprint (usually one).
3. \`list_tickets\` (optionally filter by \`status\`, \`type\`, \`assignee\`, \`sprint\`) → get a
   compact list.
4. \`get_ticket\` with a ticket id → returns the full ticket **plus its description and all
   comments**. Prefer this over \`list_tickets\` when you need context.
5. \`search_tickets\` with a query → title + description + comment full-text search.

## Mutations
- \`create_ticket\` (type + title required). Default status is \`backlog\`, default estimate is 1.
- \`edit_ticket\` — partial update of title/description/priority/estimate/labels (use
  \`clear_*\` booleans to unset).
- \`update_ticket_status\` — the fastest way to move a card. Emits a WebSocket broadcast
  so the web UI live-refreshes.
- \`assign_ticket\` — set or clear the assignee. Accepts a User id or a bare username.
- \`set_ticket_sprint\` — add/remove a ticket from a sprint.
- \`add_comment\` — thread a comment. Author must be a User id or a resolvable username.
- \`create_sprint\` / \`edit_sprint\` / \`update_sprint_status\` — sprint lifecycle.
- \`create_user\` / \`edit_user\` — people.

## Read tools
- \`get_ticket\` returns \`{ ticket, comments, assignee, sprint }\` — richer than
  \`list_tickets\`, use it whenever you need the description.
- \`list_tickets\` returns an array of ticket objects (no comments). Supports filters:
  \`type\`, \`status\`, \`priority\`, \`assignee\`, \`sprint\`, \`sprintName\`, \`hasSprint\`,
  \`limit\`, \`sortBy\`.
- \`search_tickets\` runs a case-insensitive substring search over title, description,
  and comment bodies; returns tickets ranked by match count.

## Broadcasts
Every mutation broadcasts a WebSocket event to any connected web UI so users see
changes live. You do not need to call anything to trigger this.

## Suggested defaults
- Prefer \`get_ticket\` before editing so you know current state.
- When status changes to \`review\` or \`blocked\`, also \`add_comment\` explaining why —
  it makes the timeline useful.
- If a sprint doesn't exist yet, create one in \`planning\` status, then move to
  \`active\` when the team starts working.

## Dependencies
Tickets can declare inter-ticket blockers via \`dependsOn: string[]\`. Deps are
surfaced in every read tool:
- \`list_tickets\` — each row includes \`dependsOn\` (normalized to \`[]\`) and
  \`blockedBy\` (unmet non-done or missing deps). One call is enough to build a
  full dep graph across a sprint.
- \`get_ticket\` — richer: \`dependencies\` array carries resolved title/status
  per dep (or \`{ missing: true }\`) plus the same \`blockedBy\`.

Rules of thumb:
- Before starting work: if \`blockedBy\` is non-empty, do not proceed. Set the
  ticket \`status: "blocked"\` + \`add_comment\` naming what it's waiting on.
- Orchestrators must topological-sort children by \`dependsOn\` before fanning
  out: only tickets whose \`blockedBy\` is empty are safe to parallel-execute in
  the first wave. Fan out later waves as earlier ones move to \`done\`.
- Set/edit deps via \`edit_ticket\` (\`dependsOn\`, \`addDependencies\`,
  \`removeDependencies\`, \`clearDependencies\`) or \`create_ticket\` (\`dependsOn\`).
- The system does not enforce acyclicity — orchestrators should detect cycles
  and escalate.

## Worktrees (concurrent work)
Every ticket can be associated with a git worktree so multiple agents can work on
different tickets simultaneously without stepping on each other's branch state.

- \`create_worktree\` — creates a fresh worktree + branch for a ticket. Default path
  \`../<repo>-worktrees/<ticket-id>\`, default branch \`tkxr/<ticket-id>\`. Both overridable.
  Sets \`ticket.worktree = { path, branch, createdAt }\` so anyone who fetches the
  ticket knows where to work.
- \`remove_worktree\` — deletes the worktree directory + prunes git metadata. By
  default also deletes the branch (pass \`keepBranch: true\` to keep it around).
- \`list_worktrees\` — mirrors \`git worktree list\`.

If you're about to work on a ticket and \`ticket.worktree\` is null, consider
creating one first — then \`cd\` into it and do the work there. Commits inside a
worktree are just regular commits on that branch; push and PR as normal.

## Claude CLI runner (out-of-band)
The \`tkxr serve\` HTTP surface also exposes a \`claude\` CLI runner at
\`POST /api/claude/run\` + \`POST /api/claude/cancel\`, streaming output over
the WebSocket as \`claude_run_started | claude_run_chunk | claude_run_exit\`
events. It is **not** an MCP tool — the web UI drives it directly to power
"Run in Claude" / "Plan with Claude" buttons, with a clipboard fallback
when the binary is missing. Agents connected via MCP should keep using
their own LLM loop; the endpoint is here for the human-facing UI.
`;

export const TOOLS: ToolDef[] = [
  // -------------- Read tools --------------
  {
    name: 'agent_guide',
    description: 'Return the tkxr agent guide: data model, typical flow, and best-practice suggestions. Call this first when unsure.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => textResult(AGENT_GUIDE),
  },
  {
    name: 'list_tickets',
    description: 'List tickets as an array of ticket objects (no comments). Each row includes normalized dependsOn + computed blockedBy (unmet non-done deps) so orchestrators can dep-plan in a single call. Supports filters and sorting. Use get_ticket for full detail with description and comments.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['task', 'bug'], description: 'Filter by ticket type' },
        status: { type: 'string', enum: [...STATUSES], description: 'Filter by status' },
        priority: { type: 'string', enum: [...PRIORITIES], description: 'Filter by priority' },
        assignee: { type: 'string', description: 'Filter by assignee (User id or username). Use "none" for unassigned.' },
        sprint: { type: 'string', description: 'Filter by sprint id. Use "none" for tickets not in a sprint.' },
        sprintName: { type: 'string', description: 'Filter by sprint name (case-insensitive substring match).' },
        hasSprint: { type: 'boolean', description: 'When true, only tickets attached to a sprint.' },
        limit: { type: 'number', description: 'Max tickets to return (default 200).' },
        sortBy: { type: 'string', enum: ['updated', 'created', 'priority', 'title'], description: 'Sort order (default: updated desc).' },
      },
    },
    handler: async (args, { storage }) => {
      let tickets = await storage.getAllTickets();
      const sprints = await storage.getSprints();
      const statusById = new Map(tickets.map(t => [t.id, t.status]));

      let sprintIdFilter: string | null = null;
      if (args.sprintName) {
        const q = String(args.sprintName).toLowerCase();
        const found = sprints.find(s => s.name.toLowerCase().includes(q));
        sprintIdFilter = found?.id || '__none__';
      }

      let assigneeFilter: string | null = null;
      if (args.assignee && args.assignee !== 'none') {
        const uid = await resolveUserId(storage, args.assignee);
        assigneeFilter = uid || '__none__';
      }

      tickets = tickets.filter(t => {
        if (args.type && t.type !== args.type) return false;
        if (args.status && t.status !== args.status) return false;
        if (args.priority && t.priority !== args.priority) return false;
        if (args.assignee === 'none' && t.assignee) return false;
        if (assigneeFilter && t.assignee !== assigneeFilter) return false;
        if (args.sprint === 'none' && t.sprint) return false;
        if (args.sprint && args.sprint !== 'none' && t.sprint !== args.sprint) return false;
        if (sprintIdFilter && t.sprint !== sprintIdFilter) return false;
        if (args.hasSprint === true && !t.sprint) return false;
        if (args.hasSprint === false && t.sprint) return false;
        return true;
      });

      const priOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      switch (args.sortBy) {
        case 'title':
          tickets.sort((a, b) => a.title.localeCompare(b.title));
          break;
        case 'created':
          tickets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          break;
        case 'priority':
          tickets.sort((a, b) => (priOrder[a.priority || 'medium']) - (priOrder[b.priority || 'medium']));
          break;
        case 'updated':
        default:
          tickets.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      }

      const limit = args.limit ?? 200;
      const sliced = tickets.slice(0, limit);
      const enriched = sliced.map(t => {
        const dependsOn = t.dependsOn || [];
        const blockedBy = dependsOn.filter(depId => {
          const s = statusById.get(depId);
          return s === undefined || s !== 'done';
        });
        return { ...t, dependsOn, blockedBy };
      });
      return jsonResult({ count: tickets.length, tickets: enriched });
    },
  },
  {
    name: 'get_ticket',
    description: 'Return a single ticket with its FULL description, all comments, resolved assignee, and resolved sprint. Prefer this over list_tickets when you need context.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Ticket id (e.g. tas-abc123)' } },
      required: ['id'],
    },
    handler: async ({ id }, { storage }) => {
      const found = await storage.findTicket(id);
      if (!found) return errorResult(`Ticket "${id}" not found.`);
      const ticket = found.ticket;
      const comments = await storage.getComments(id);
      const users = await storage.getUsers();
      const sprints = await storage.getSprints();
      const allTickets = await storage.getAllTickets();
      const assignee = ticket.assignee ? users.find(u => u.id === ticket.assignee) || null : null;
      const sprint = ticket.sprint ? sprints.find(s => s.id === ticket.sprint) || null : null;
      const dependencies = (ticket.dependsOn || []).map(dep => {
        const t = allTickets.find(x => x.id === dep);
        return t
          ? { id: t.id, title: t.title, status: t.status, done: t.status === 'done' }
          : { id: dep, missing: true };
      });
      const blockedBy = dependencies.filter(d => !d.done && !('missing' in d && d.missing));
      return jsonResult({ ticket, comments, assignee, sprint, dependencies, blockedBy });
    },
  },
  {
    name: 'search_tickets',
    description: 'Full-text search across ticket titles, descriptions, and comment bodies. Returns tickets ranked by match count.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (case-insensitive substring).' },
        limit: { type: 'number', description: 'Max results (default 20).' },
        includeDone: { type: 'boolean', description: 'Include tickets in status=done (default false).' },
      },
      required: ['query'],
    },
    handler: async ({ query, limit, includeDone }, { storage }) => {
      const q = String(query || '').toLowerCase().trim();
      if (!q) return errorResult('query is required');
      const tickets = await storage.getAllTickets();
      // Read every comment once, then group by ticketId. Previously this loop
      // called storage.getComments(t.id) per ticket — each call re-scanned every
      // NDJSON chunk on disk (classic N+1). Grouping upfront collapses N disk
      // scans into 1.
      const allComments = await storage.getAllComments();
      const commentsByTicket = new Map<string, string>();
      for (const c of allComments) {
        const prev = commentsByTicket.get(c.ticketId);
        commentsByTicket.set(c.ticketId, prev ? `${prev} ${c.content}` : c.content);
      }
      const results: { ticket: Ticket; score: number; snippet: string }[] = [];
      for (const t of tickets) {
        if (!includeDone && t.status === 'done') continue;
        const hay = `${t.title} ${t.description || ''}`.toLowerCase();
        const cText = (commentsByTicket.get(t.id) || '').toLowerCase();
        const inTitle = (t.title.toLowerCase().match(new RegExp(escapeRe(q), 'g')) || []).length;
        const inDesc = (t.description || '').toLowerCase().split(q).length - 1;
        const inComments = cText.split(q).length - 1;
        const score = inTitle * 3 + inDesc + inComments;
        if (score > 0) {
          const snippet = snippetFor(hay, q) || snippetFor(cText, q) || '';
          results.push({ ticket: t, score, snippet });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return jsonResult({ count: results.length, results: results.slice(0, limit ?? 20) });
    },
  },
  {
    name: 'list_users',
    description: 'List all users as an array. Cache the result to resolve @usernames to user ids for later calls.',
    inputSchema: { type: 'object', properties: {} },
    handler: async (_a, { storage }) => jsonResult(await storage.getUsers()),
  },
  {
    name: 'get_user',
    description: 'Return a single user with tickets currently assigned to them.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string', description: 'User id or username' } },
      required: ['ref'],
    },
    handler: async ({ ref }, { storage }) => {
      const uid = await resolveUserId(storage, ref);
      if (!uid) return errorResult(`User "${ref}" not found`);
      const users = await storage.getUsers();
      const user = users.find(u => u.id === uid)!;
      const tickets = (await storage.getAllTickets()).filter(t => t.assignee === uid);
      return jsonResult({ user, assigned: tickets });
    },
  },
  {
    name: 'list_sprints',
    description: 'List sprints, optionally filtered by status. Includes ticket counts per sprint.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: [...SPRINT_STATUSES] } },
    },
    handler: async ({ status }, { storage }) => {
      let sprints = await storage.getSprints();
      if (status) sprints = sprints.filter(s => s.status === status);
      const tickets = await storage.getAllTickets();
      const enriched = sprints.map(s => {
        const scoped = tickets.filter(t => t.sprint === s.id);
        const total = scoped.length;
        const donePts = scoped.filter(t => t.status === 'done').reduce((sum, t) => sum + (t.estimate || 0), 0);
        const totalPts = scoped.reduce((sum, t) => sum + (t.estimate || 0), 0);
        return { ...s, ticketCount: total, donePoints: donePts, totalPoints: totalPts };
      });
      return jsonResult(enriched);
    },
  },
  {
    name: 'get_sprint',
    description: 'Return a single sprint with its full ticket list.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async ({ id }, { storage }) => {
      const sprints = await storage.getSprints();
      const sprint = sprints.find(s => s.id === id);
      if (!sprint) return errorResult(`Sprint "${id}" not found`);
      const tickets = (await storage.getAllTickets()).filter(t => t.sprint === id);
      return jsonResult({ sprint, tickets });
    },
  },
  {
    name: 'list_comments',
    description: 'List all comments for a ticket in chronological order.',
    inputSchema: {
      type: 'object',
      properties: { ticketId: { type: 'string' } },
      required: ['ticketId'],
    },
    handler: async ({ ticketId }, { storage }) => jsonResult(await storage.getComments(ticketId)),
  },

  // -------------- Write tools --------------
  {
    name: 'create_ticket',
    description: 'Create a new ticket. Defaults: status=backlog, estimate=1. Returns the created ticket. Broadcasts ticket_created.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['task', 'bug'] },
        title: { type: 'string' },
        description: { type: 'string' },
        assignee: { type: 'string', description: 'User id or username' },
        sprint: { type: 'string', description: 'Sprint id' },
        priority: { type: 'string', enum: [...PRIORITIES] },
        estimate: { type: 'number' },
        status: { type: 'string', enum: [...STATUSES], description: 'Override initial status (defaults to backlog).' },
        labels: { type: 'array', items: { type: 'string' } },
        dependsOn: { type: 'array', items: { type: 'string' }, description: 'Ticket ids this new ticket blocks on' },
      },
      required: ['type', 'title'],
    },
    handler: async (args, { storage, broadcast }) => {
      const assigneeId = args.assignee ? await resolveUserId(storage, args.assignee) : undefined;
      const opts: Partial<Ticket> = {};
      if (args.description !== undefined) opts.description = args.description;
      if (assigneeId) opts.assignee = assigneeId;
      if (args.sprint) opts.sprint = args.sprint;
      if (args.priority) opts.priority = args.priority;
      if (args.estimate !== undefined) opts.estimate = args.estimate;
      if (args.labels) opts.labels = args.labels;
      if (Array.isArray(args.dependsOn)) opts.dependsOn = args.dependsOn.filter((d: string) => !!d);
      const ticket = await storage.createTicket(args.type, args.title, opts);
      let final = ticket;
      if (args.status && args.status !== 'backlog') {
        const updated = await storage.updateTicketStatus(ticket.id, args.status as TicketStatus);
        if (updated) final = updated;
      }
      broadcast?.({ type: 'ticket_created', data: final });
      return jsonResult(final);
    },
  },
  {
    name: 'edit_ticket',
    description: 'Partial-update a ticket. Any field passed is applied; use clear_* booleans to unset. Broadcasts ticket_updated.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: [...PRIORITIES] },
        estimate: { type: 'number' },
        assignee: { type: 'string', description: 'User id or username' },
        sprint: { type: 'string', description: 'Sprint id' },
        addLabels: { type: 'array', items: { type: 'string' } },
        removeLabels: { type: 'array', items: { type: 'string' } },
        clearLabels: { type: 'boolean' },
        dependsOn: { type: 'array', items: { type: 'string' }, description: 'Replace dependsOn with this list of ticket ids' },
        addDependencies: { type: 'array', items: { type: 'string' }, description: 'Ticket ids to add to dependsOn' },
        removeDependencies: { type: 'array', items: { type: 'string' }, description: 'Ticket ids to remove from dependsOn' },
        clearDependencies: { type: 'boolean' },
        clearDescription: { type: 'boolean' },
        clearPriority: { type: 'boolean' },
        clearEstimate: { type: 'boolean' },
        clearAssignee: { type: 'boolean' },
        clearSprint: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async (args, { storage, broadcast }) => {
      const patch: any = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.description !== undefined) patch.description = args.description;
      if (args.priority !== undefined) patch.priority = args.priority;
      if (args.estimate !== undefined) patch.estimate = args.estimate;
      if (args.assignee !== undefined) patch.assignee = await resolveUserId(storage, args.assignee);
      if (args.sprint !== undefined) patch.sprint = args.sprint;
      if (args.clearDescription) patch.description = undefined;
      if (args.clearPriority) patch.priority = undefined;
      if (args.clearEstimate) patch.estimate = undefined;
      if (args.clearAssignee) patch.assignee = undefined;
      if (args.clearSprint) patch.sprint = undefined;

      const found = await storage.findTicket(args.id);
      if (!found) return errorResult(`Ticket "${args.id}" not found`);
      let labels = found.ticket.labels || [];
      if (args.clearLabels) labels = [];
      if (Array.isArray(args.addLabels)) labels = [...new Set([...labels, ...args.addLabels])];
      if (Array.isArray(args.removeLabels)) labels = labels.filter(l => !args.removeLabels.includes(l));
      if (args.clearLabels || args.addLabels || args.removeLabels) patch.labels = labels;

      let deps = found.ticket.dependsOn || [];
      if (args.clearDependencies) deps = [];
      if (Array.isArray(args.dependsOn)) deps = args.dependsOn.filter((d: string) => d && d !== args.id);
      if (Array.isArray(args.addDependencies)) deps = [...new Set([...deps, ...args.addDependencies.filter((d: string) => d && d !== args.id)])];
      if (Array.isArray(args.removeDependencies)) deps = deps.filter(d => !args.removeDependencies.includes(d));
      if (args.clearDependencies || args.dependsOn !== undefined || args.addDependencies || args.removeDependencies) {
        patch.dependsOn = deps;
      }

      const updated = await storage.updateTicket(args.id, patch);
      if (!updated) return errorResult(`Failed to update ticket "${args.id}"`);
      broadcast?.({ type: 'ticket_updated', data: updated });
      return jsonResult(updated);
    },
  },
  {
    name: 'update_ticket_status',
    description: 'Move a ticket between columns. Fast path when only status changes. Broadcasts ticket_updated.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: [...STATUSES] },
      },
      required: ['id', 'status'],
    },
    handler: async ({ id, status }, { storage, broadcast }) => {
      const updated = await storage.updateTicketStatus(id, status);
      if (!updated) return errorResult(`Ticket "${id}" not found`);
      broadcast?.({ type: 'ticket_updated', data: updated });
      return jsonResult(updated);
    },
  },
  {
    name: 'assign_ticket',
    description: 'Assign a ticket to a user or clear its assignee. user may be a user id or a bare @username.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        user: { type: 'string' },
        unassign: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async ({ id, user, unassign }, { storage, broadcast }) => {
      let assignee: string | undefined | null;
      if (unassign) assignee = null;
      else if (user) {
        const uid = await resolveUserId(storage, user);
        if (!uid) return errorResult(`User "${user}" not found`);
        assignee = uid;
      } else return errorResult('Provide "user" or set "unassign": true');
      const updated = await storage.updateTicket(id, { assignee: assignee as any });
      if (!updated) return errorResult(`Ticket "${id}" not found`);
      broadcast?.({ type: 'ticket_updated', data: updated });
      return jsonResult(updated);
    },
  },
  {
    name: 'set_ticket_sprint',
    description: 'Add a ticket to a sprint or remove it. Provide sprintId to add, or set unset:true to remove.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        sprintId: { type: 'string' },
        unset: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async ({ id, sprintId, unset }, { storage, broadcast }) => {
      const patch: any = unset ? { sprint: null } : { sprint: sprintId };
      const updated = await storage.updateTicket(id, patch);
      if (!updated) return errorResult(`Ticket "${id}" not found`);
      broadcast?.({ type: 'ticket_updated', data: updated });
      return jsonResult(updated);
    },
  },
  {
    name: 'delete_ticket',
    description: 'Delete a ticket by id. Also deletes its comments. Broadcasts ticket_deleted.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async ({ id }, { storage, broadcast }) => {
      const comments = await storage.getComments(id);
      for (const c of comments) await storage.deleteComment(c.id);
      const ok = await storage.deleteTicket(id);
      if (!ok) return errorResult(`Ticket "${id}" not found`);
      broadcast?.({ type: 'ticket_deleted', data: { id } });
      return jsonResult({ id, deleted: true });
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a ticket. Author may be a User id or a bare username.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        author: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['ticketId', 'author', 'content'],
    },
    handler: async ({ ticketId, author, content }, { storage, broadcast }) => {
      const authorId = await resolveUserId(storage, author);
      if (!authorId) return errorResult(`Author "${author}" not found`);
      const comment = await storage.createComment(ticketId, authorId, content);
      broadcast?.({ type: 'comment_created', data: comment });
      return jsonResult(comment);
    },
  },
  {
    name: 'delete_comment',
    description: 'Delete a comment by id.',
    inputSchema: {
      type: 'object',
      properties: {
        commentId: { type: 'string' },
        ticketId: { type: 'string', description: 'Optional; included in broadcast so UI can scope refresh.' },
      },
      required: ['commentId'],
    },
    handler: async ({ commentId, ticketId }, { storage, broadcast }) => {
      const ok = await storage.deleteComment(commentId);
      if (!ok) return errorResult(`Comment "${commentId}" not found`);
      broadcast?.({ type: 'comment_deleted', data: { id: commentId, ticketId } });
      return jsonResult({ id: commentId, deleted: true });
    },
  },
  {
    name: 'create_sprint',
    description: 'Create a new sprint. Defaults to status=planning.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        goal: { type: 'string' },
        status: { type: 'string', enum: [...SPRINT_STATUSES] },
        startDate: { type: 'string', description: 'ISO date' },
        endDate: { type: 'string', description: 'ISO date' },
      },
      required: ['name'],
    },
    handler: async (args, { storage, broadcast }) => {
      const opts: Partial<Sprint> = {};
      if (args.description) opts.description = args.description;
      if (args.goal) opts.goal = args.goal;
      if (args.status) opts.status = args.status;
      if (args.startDate) opts.startDate = new Date(args.startDate);
      if (args.endDate) opts.endDate = new Date(args.endDate);
      const sprint = await storage.createSprint(args.name, opts);
      broadcast?.({ type: 'sprint_created', data: sprint });
      return jsonResult(sprint);
    },
  },
  {
    name: 'edit_sprint',
    description: 'Partial-update a sprint (name, description, goal, dates, status).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        goal: { type: 'string' },
        status: { type: 'string', enum: [...SPRINT_STATUSES] },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        clearDescription: { type: 'boolean' },
        clearGoal: { type: 'boolean' },
        clearStartDate: { type: 'boolean' },
        clearEndDate: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async (args, { storage, broadcast }) => {
      const patch: any = {};
      if (args.name !== undefined) patch.name = args.name;
      if (args.description !== undefined) patch.description = args.description;
      if (args.goal !== undefined) patch.goal = args.goal;
      if (args.status !== undefined) patch.status = args.status;
      if (args.startDate !== undefined) patch.startDate = new Date(args.startDate);
      if (args.endDate !== undefined) patch.endDate = new Date(args.endDate);
      if (args.clearDescription) patch.description = undefined;
      if (args.clearGoal) patch.goal = undefined;
      if (args.clearStartDate) patch.startDate = undefined;
      if (args.clearEndDate) patch.endDate = undefined;
      const updated = await storage.updateSprint(args.id, patch);
      if (!updated) return errorResult(`Sprint "${args.id}" not found`);
      broadcast?.({ type: 'sprint_updated', data: updated });
      return jsonResult(updated);
    },
  },
  {
    name: 'update_sprint_status',
    description: 'Move a sprint through planning → active → completed.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: [...SPRINT_STATUSES] },
      },
      required: ['id', 'status'],
    },
    handler: async ({ id, status }, { storage, broadcast }) => {
      const updated = await storage.updateSprintStatus(id, status);
      if (!updated) return errorResult(`Sprint "${id}" not found`);
      broadcast?.({ type: 'sprint_updated', data: updated });
      return jsonResult(updated);
    },
  },
  {
    name: 'delete_sprint',
    description: 'Delete a sprint by id. Any tickets attached to the sprint have their sprint field cleared and each is re-broadcast as ticket_updated so open web clients refresh.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    handler: async ({ id }, { storage, broadcast }) => {
      const { ok, sweptTickets } = await storage.deleteSprint(id);
      if (!ok) return errorResult(`Sprint "${id}" not found`);
      broadcast?.({ type: 'sprint_deleted', data: { id } });
      for (const t of sweptTickets) {
        broadcast?.({ type: 'ticket_updated', data: t });
      }
      return jsonResult({ id, deleted: true, sweptTicketIds: sweptTickets.map(t => t.id) });
    },
  },
  {
    name: 'create_user',
    description: 'Create a new user.',
    inputSchema: {
      type: 'object',
      properties: {
        username: { type: 'string' },
        displayName: { type: 'string' },
        email: { type: 'string' },
        color: { type: 'string', description: 'Hex color for avatar' },
      },
      required: ['username', 'displayName'],
    },
    handler: async (args, { storage, broadcast }) => {
      const opts: Partial<User> = {};
      if (args.email) opts.email = args.email;
      if (args.color) opts.color = args.color;
      const user = await storage.createUser(args.username, args.displayName, opts);
      broadcast?.({ type: 'user_created', data: user });
      return jsonResult(user);
    },
  },
  {
    name: 'edit_user',
    description: 'Partial-update a user (username, displayName, email, color).',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'User id or username' },
        username: { type: 'string' },
        displayName: { type: 'string' },
        email: { type: 'string' },
        color: { type: 'string' },
        clearEmail: { type: 'boolean' },
      },
      required: ['ref'],
    },
    handler: async (args, { storage, broadcast }) => {
      const uid = await resolveUserId(storage, args.ref);
      if (!uid) return errorResult(`User "${args.ref}" not found`);
      const patch: any = {};
      if (args.username !== undefined) patch.username = args.username;
      if (args.displayName !== undefined) patch.displayName = args.displayName;
      if (args.email !== undefined) patch.email = args.email;
      if (args.color !== undefined) patch.color = args.color;
      if (args.clearEmail) patch.email = undefined;
      const updated = await storage.updateUser(uid, patch);
      if (!updated) return errorResult(`Failed to update user "${uid}"`);
      broadcast?.({ type: 'user_updated', data: updated });
      return jsonResult(updated);
    },
  },
  {
    name: 'delete_user',
    description: 'Delete a user. Any tickets assigned to them are automatically unassigned (ticket.assignee cleared) and each unassigned ticket broadcasts a ticket_updated event.',
    inputSchema: {
      type: 'object',
      properties: { ref: { type: 'string' } },
      required: ['ref'],
    },
    handler: async ({ ref }, { storage, broadcast }) => {
      const uid = await resolveUserId(storage, ref);
      if (!uid) return errorResult(`User "${ref}" not found`);
      const { deleted, unassignedTickets } = await storage.deleteUser(uid);
      if (!deleted) return errorResult(`Failed to delete user "${uid}"`);
      broadcast?.({ type: 'user_deleted', data: { id: uid } });
      for (const t of unassignedTickets) {
        broadcast?.({ type: 'ticket_updated', data: t });
      }
      return jsonResult({ id: uid, deleted: true, unassignedTicketIds: unassignedTickets.map(t => t.id) });
    },
  },

  // -------------- Worktree tools --------------
  {
    name: 'create_worktree',
    description: 'Create a git worktree + branch for a ticket so agents can work on it in isolation. Default path: ../<repo>-worktrees/<ticket-id>. Default branch: tkxr/<ticket-id>. If the ticket belongs to a sprint that has its own worktree, the new branch is automatically based off the sprint branch (pass explicit `base` to override). Sets ticket.worktree and broadcasts ticket_updated.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        path: { type: 'string', description: 'Override the default worktree path' },
        branch: { type: 'string', description: 'Override the default branch name' },
        base: { type: 'string', description: 'Base branch/ref for the new branch (default HEAD, or sprint branch if ticket is in a sprint with a worktree)' },
      },
      required: ['ticketId'],
    },
    handler: async ({ ticketId, path: p, branch, base }, { storage, broadcast }) => {
      const found = await storage.findTicket(ticketId);
      if (!found) return errorResult(`Ticket "${ticketId}" not found`);
      if (found.ticket.worktree) {
        return errorResult(`Ticket already has a worktree at ${found.ticket.worktree.path}. Remove it first if you want a different one.`);
      }
      if (!(await isGitRepo())) return errorResult('Not a git repository. Run this from inside a git repo.');

      let effectiveBase = base;
      if (!effectiveBase && found.ticket.sprint) {
        const sprints = await storage.getSprints();
        const sprint = sprints.find(s => s.id === found.ticket.sprint);
        if (sprint?.worktree) effectiveBase = sprint.worktree.branch;
      }

      try {
        const result = await createWorktree({ ticketId, path: p, branch, base: effectiveBase });
        const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
        const updated = await storage.updateTicket(ticketId, { worktree: wt });
        if (!updated) return errorResult(`Ticket "${ticketId}" disappeared during update`);
        broadcast?.({ type: 'ticket_updated', data: updated });
        return jsonResult({ ticket: updated, worktree: wt, basedOn: effectiveBase || 'HEAD' });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: 'create_sprint_worktree',
    description: 'Create a git worktree + feature branch for a sprint. Default path: ../<repo>-worktrees/sprints/<sprint-id>. Default branch: tkxr/sprint/<sprint-id>. Held by the orchestrator agent — sub-agents work in per-ticket worktrees and the orchestrator merges their branches into this one. Sets sprint.worktree and broadcasts sprint_updated.',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string' },
        path: { type: 'string', description: 'Override the default sprint worktree path' },
        branch: { type: 'string', description: 'Override the default sprint branch name' },
        base: { type: 'string', description: 'Base branch/ref for the new sprint branch (default HEAD)' },
      },
      required: ['sprintId'],
    },
    handler: async ({ sprintId, path: p, branch, base }, { storage, broadcast }) => {
      const sprints = await storage.getSprints();
      const sprint = sprints.find(s => s.id === sprintId);
      if (!sprint) return errorResult(`Sprint "${sprintId}" not found`);
      if (sprint.worktree) {
        return errorResult(`Sprint already has a worktree at ${sprint.worktree.path}. Remove it first if you want a different one.`);
      }
      if (!(await isGitRepo())) return errorResult('Not a git repository.');
      try {
        const result = await createSprintWorktree({ sprintId, path: p, branch, base });
        const wt = { path: result.path, branch: result.branch, createdAt: new Date().toISOString() };
        const updated = await storage.updateSprint(sprintId, { worktree: wt });
        if (!updated) return errorResult(`Sprint "${sprintId}" disappeared during update`);
        broadcast?.({ type: 'sprint_updated', data: updated });
        return jsonResult({ sprint: updated, worktree: wt });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  },
  {
    name: 'remove_sprint_worktree',
    description: 'Remove a sprint\'s worktree. Deletes the working directory + prunes metadata + (by default) deletes the sprint feature branch. Pass keepBranch:true to keep the branch (e.g. after merging up to main). Clears sprint.worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        sprintId: { type: 'string' },
        force: { type: 'boolean', description: 'Force removal even if the worktree has uncommitted changes' },
        keepBranch: { type: 'boolean', description: 'Do not delete the sprint branch after removing the worktree (default: false)' },
      },
      required: ['sprintId'],
    },
    handler: async ({ sprintId, force, keepBranch }, { storage, broadcast }) => {
      const sprints = await storage.getSprints();
      const sprint = sprints.find(s => s.id === sprintId);
      if (!sprint) return errorResult(`Sprint "${sprintId}" not found`);
      const wt = sprint.worktree;
      if (!wt) return errorResult(`Sprint has no worktree.`);
      try {
        await removeWorktree({ path: wt.path, branch: wt.branch, force, keepBranch });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
      const updated = await storage.updateSprint(sprintId, { worktree: null });
      if (updated) broadcast?.({ type: 'sprint_updated', data: updated });
      return jsonResult({ sprint: updated, removed: wt });
    },
  },
  {
    name: 'remove_worktree',
    description: 'Remove a git worktree associated with a ticket. Deletes the working directory + prunes metadata + (by default) deletes the branch. Pass keepBranch:true to keep the branch. Clears ticket.worktree.',
    inputSchema: {
      type: 'object',
      properties: {
        ticketId: { type: 'string' },
        force: { type: 'boolean', description: 'Force removal even if the worktree has uncommitted changes' },
        keepBranch: { type: 'boolean', description: 'Do not delete the branch after removing the worktree (default: false)' },
      },
      required: ['ticketId'],
    },
    handler: async ({ ticketId, force, keepBranch }, { storage, broadcast }) => {
      const found = await storage.findTicket(ticketId);
      if (!found) return errorResult(`Ticket "${ticketId}" not found`);
      const wt = found.ticket.worktree;
      if (!wt) return errorResult(`Ticket has no worktree.`);
      try {
        await removeWorktree({ path: wt.path, branch: wt.branch, force, keepBranch });
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
      const updated = await storage.updateTicket(ticketId, { worktree: null });
      if (updated) broadcast?.({ type: 'ticket_updated', data: updated });
      return jsonResult({ ticket: updated, removed: wt });
    },
  },
  {
    name: 'list_worktrees',
    description: 'List all git worktrees for the current repo (mirrors `git worktree list --porcelain`). Includes non-tkxr worktrees.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      if (!(await isGitRepo())) return errorResult('Not a git repository.');
      try {
        const worktrees = await listWorktrees();
        return jsonResult(worktrees);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  },
];

export const TOOL_MAP: Record<string, ToolDef> = Object.fromEntries(TOOLS.map(t => [t.name, t]));

export const SERVER_INSTRUCTIONS = `tkxr MCP — call agent_guide first to see the data model and workflow tips. Read tools return structured JSON (list_tickets, get_ticket, search_tickets, list_users, list_sprints). Every mutation broadcasts a WebSocket event so a connected web UI live-refreshes.`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function snippetFor(hay: string, needle: string, radius = 60): string | null {
  const i = hay.indexOf(needle);
  if (i < 0) return null;
  const start = Math.max(0, i - radius);
  const end = Math.min(hay.length, i + needle.length + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < hay.length ? '…' : '';
  return prefix + hay.slice(start, end).replace(/\s+/g, ' ').trim() + suffix;
}
