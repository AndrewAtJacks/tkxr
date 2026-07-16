import { promises as fs } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import type { Ticket, Sprint, User, TicketType, TicketStatus, TicketComment } from './types.js';
import { isGitRepo, removeWorktree } from './worktree.js';

// --- queryTickets support -----------------------------------------------------
// Kept in this file (rather than types.ts) because they describe the *storage*
// query surface, not the persisted data model. The HTTP handler in serve.ts
// re-exports the client-facing response shape from here.

export type TicketSortBy = 'updated' | 'created' | 'priority' | 'title';

export interface TicketQueryOptions {
  limit?: number;
  cursor?: string;
  q?: string;
  /** Sprint id, the literal `'none'` to match unassigned-to-sprint, or omitted. */
  sprint?: string;
  /** User id, the literal `'none'` to match unassigned, or omitted. */
  assignee?: string;
  type?: TicketType;
  status?: TicketStatus;
  sortBy?: TicketSortBy;
}

export interface TicketQueryResult {
  items: Ticket[];
  nextCursor: string | null;
  total: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// Mirrors src/web/src/lib/util.ts PRIORITY_ORDER — kept in sync manually since
// the server can't import from the web bundle. If you change the order there,
// update it here too.
const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  const n = Math.floor(limit);
  if (n <= 0) return DEFAULT_LIMIT;
  if (n > MAX_LIMIT) return MAX_LIMIT;
  return n;
}

function getSortValue(t: Ticket, sortBy: TicketSortBy): string {
  switch (sortBy) {
    case 'title': return t.title;
    case 'created': return new Date(t.createdAt).toISOString();
    case 'priority': return String(PRIORITY_ORDER[t.priority || 'medium']);
    case 'updated':
    default: return new Date(t.updatedAt).toISOString();
  }
}

function encodeCursor(t: Ticket, sortBy: TicketSortBy): string {
  // Base64 keeps the payload opaque + URL-safe. The `|` separator inside
  // survives fine because base64 doesn't produce it.
  const raw = `${getSortValue(t, sortBy)}|${t.id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { sortValue: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sepIdx = raw.lastIndexOf('|');
    if (sepIdx < 0) return null;
    return { sortValue: raw.slice(0, sepIdx), id: raw.slice(sepIdx + 1) };
  } catch {
    return null;
  }
}

export class ProjectStorage {
  private ticketsDir: string;
  private commentsDir: string;
  private sprintsPath: string;
  private usersPath: string;

  constructor(basePath: string = './tkxr') {
    this.ticketsDir = path.resolve(basePath, 'tickets');
    this.commentsDir = path.resolve(basePath, 'comments');
    this.sprintsPath = path.resolve(basePath, 'sprints.json');
    this.usersPath = path.resolve(basePath, 'users.json');
  }

  private generateId(type: string): string {
    const prefix = type.substring(0, 3);
    const id = nanoid(8);
    return `${prefix}-${id}`;
  }

  private async ensureBaseDir(): Promise<void> {
    await fs.mkdir(path.dirname(this.usersPath), { recursive: true });
  }

  // User CRUD
  async createUser(username: string, displayName: string, options: Partial<User> = {}): Promise<User> {
    const now = new Date();
    const user: User = {
      id: this.generateId('user'),
      username,
      displayName,
      createdAt: now,
      updatedAt: now,
      ...options,
    };
    const users = await this.getUsers();
    users.push(user);
    await this.ensureBaseDir();
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), 'utf8');
    return user;
  }

  async getUsers(): Promise<User[]> {
    try {
      const content = await fs.readFile(this.usersPath, 'utf8');
      const users = JSON.parse(content);
      return users.map((u: any) => ({
        ...u,
        createdAt: new Date(u.createdAt),
        updatedAt: new Date(u.updatedAt),
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<{ deleted: boolean; unassignedTickets: Ticket[] }> {
    const users = await this.getUsers();
    const index = users.findIndex(u => u.id === userId);
    if (index === -1) return { deleted: false, unassignedTickets: [] };
    users.splice(index, 1);
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), 'utf8');

    // Null out ticket.assignee for every ticket that pointed at the deleted user.
    // Otherwise the board keeps rendering '?' avatars and the filter-by-user UI
    // still lists a dead id.
    const unassignedTickets: Ticket[] = [];
    const chunkFiles = await this.getTicketChunkFiles();
    for (const file of chunkFiles) {
      const filePath = path.join(this.ticketsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let touched = false;
      const newLines = lines.map(line => {
        const t = JSON.parse(line);
        if (t.assignee === userId) {
          touched = true;
          const next = { ...t, assignee: undefined, updatedAt: new Date() };
          unassignedTickets.push({
            ...next,
            createdAt: new Date(next.createdAt),
            updatedAt: new Date(next.updatedAt),
          });
          return JSON.stringify(next);
        }
        return line;
      });
      if (touched) {
        await fs.writeFile(filePath, newLines.map(l => l + '\n').join(''), 'utf8');
      }
    }

    return { deleted: true, unassignedTickets };
  }

  async updateUser(id: string, updates: Partial<Pick<User, 'username' | 'displayName' | 'email' | 'color'>>): Promise<User | null> {
    const users = await this.getUsers();
    const user = users.find(u => u.id === id);
    if (!user) return null;
    Object.assign(user, updates);
    user.updatedAt = new Date();
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), 'utf8');
    return user;
  }

  // Sprint CRUD
  async createSprint(name: string, options: Partial<Sprint> = {}): Promise<Sprint> {
    const now = new Date();
    const sprint: Sprint = {
      id: this.generateId('sprint'),
      name,
      status: 'planning',
      createdAt: now,
      updatedAt: now,
      ...options,
    };
    const sprints = await this.getSprints();
    sprints.push(sprint);
    await this.ensureBaseDir();
    await fs.writeFile(this.sprintsPath, JSON.stringify(sprints, null, 2), 'utf8');
    return sprint;
  }

  async getSprints(): Promise<Sprint[]> {
    try {
      const content = await fs.readFile(this.sprintsPath, 'utf8');
      const sprints = JSON.parse(content);
      return sprints.map((s: any) => ({
        ...s,
        createdAt: new Date(s.createdAt),
        updatedAt: new Date(s.updatedAt),
        startDate: s.startDate ? new Date(s.startDate) : undefined,
        endDate: s.endDate ? new Date(s.endDate) : undefined,
      }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async updateSprintStatus(id: string, status: Sprint['status']): Promise<Sprint | null> {
    // Route through updateSprint so status-transition hooks (e.g. auto-close worktree on
    // completed) fire consistently across all paths.
    return this.updateSprint(id, { status });
  }

  async updateSprint(id: string, updates: Partial<Pick<Sprint, 'name' | 'description' | 'goal' | 'startDate' | 'endDate' | 'status' | 'worktree'>>): Promise<Sprint | null> {
    const sprints = await this.getSprints();
    const sprint = sprints.find(s => s.id === id);
    if (!sprint) return null;
    Object.assign(sprint, updates);
    sprint.updatedAt = new Date();
    await fs.writeFile(this.sprintsPath, JSON.stringify(sprints, null, 2), 'utf8');

    // Auto-close sprint worktree when moved to completed (best effort, keep the branch —
    // it may still be pending an upstream merge / PR).
    if (sprint.status === 'completed' && sprint.worktree && updates.worktree === undefined) {
      const wt = sprint.worktree;
      try {
        if (await isGitRepo()) {
          await removeWorktree({ path: wt.path, branch: wt.branch, force: false, keepBranch: true });
          sprint.worktree = null;
          sprint.updatedAt = new Date();
          await fs.writeFile(this.sprintsPath, JSON.stringify(sprints, null, 2), 'utf8');
        }
      } catch {
        // Dirty / already gone / locked — leave sprint.worktree as-is so the human sees + decides.
      }
    }

    return sprint;
  }

  async deleteSprint(sprintId: string): Promise<{ ok: boolean; sweptTickets: Ticket[] }> {
    const sprints = await this.getSprints();
    const index = sprints.findIndex(s => s.id === sprintId);
    if (index === -1) return { ok: false, sweptTickets: [] };
    sprints.splice(index, 1);
    await fs.writeFile(this.sprintsPath, JSON.stringify(sprints, null, 2), 'utf8');

    // Sweep tickets that were attached to this sprint — leaving stale sprint refs
    // makes them disappear from any sprint view but linger under "All tickets" with
    // a broken chip. Clear the field in-place across the NDJSON chunks and return
    // the updated tickets so callers can broadcast ticket_updated for each.
    const sweptTickets: Ticket[] = [];
    const chunkFiles = await this.getTicketChunkFiles();
    for (const file of chunkFiles) {
      const filePath = path.join(this.ticketsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      let touched = false;
      const newLines = lines.map(line => {
        const t = JSON.parse(line);
        if (t.sprint === sprintId) {
          touched = true;
          const next = { ...t, sprint: undefined, updatedAt: new Date() };
          delete next.sprint;
          sweptTickets.push({
            ...next,
            createdAt: new Date(t.createdAt),
            updatedAt: next.updatedAt,
          });
          return JSON.stringify(next);
        }
        return line;
      });
      if (touched) {
        await fs.writeFile(filePath, newLines.map(l => l + '\n').join(''), 'utf8');
      }
    }

    return { ok: true, sweptTickets };
  }

  // Ticket CRUD (NDJSON)
  private async getTicketChunkFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.ticketsDir);
      return files.filter(f => f.endsWith('.ndjson'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(this.ticketsDir, { recursive: true });
        return [];
      }
      throw error;
    }
  }

  async createTicket(type: TicketType, title: string, options: Partial<Ticket> = {}): Promise<Ticket> {
    const now = new Date();
    const ticket: Ticket = {
      id: this.generateId(type),
      type,
      title,
      status: 'backlog',
      createdAt: now,
      updatedAt: now,
      ...options,
    };
    if (ticket.estimate === undefined) ticket.estimate = 1;
    const chunkFiles = await this.getTicketChunkFiles();
    let chunkFile = chunkFiles[chunkFiles.length - 1];
    if (!chunkFile) {
      chunkFile = 'tickets-0001.ndjson';
    }
    const chunkPath = path.join(this.ticketsDir, chunkFile);
    let count = 0;
    try {
      const content = await fs.readFile(chunkPath, 'utf8');
      count = content.split('\n').filter(line => line.trim()).length;
    } catch (error) {}
    if (count >= 1000) {
      const nextNum = chunkFiles.length + 1;
      chunkFile = `tickets-${String(nextNum).padStart(4, '0')}.ndjson`;
      await fs.writeFile(path.join(this.ticketsDir, chunkFile), '', 'utf8');
    }
    await fs.appendFile(path.join(this.ticketsDir, chunkFile), JSON.stringify(ticket) + '\n', 'utf8');
    return ticket;
  }

  async getAllTickets(): Promise<Ticket[]> {
    const chunkFiles = await this.getTicketChunkFiles();
    let tickets: Ticket[] = [];
    for (const file of chunkFiles) {
      const content = await fs.readFile(path.join(this.ticketsDir, file), 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      tickets = tickets.concat(lines.map(line => {
        const t = JSON.parse(line);
        return {
          ...t,
          status: t.status === 'todo' ? 'backlog' : t.status,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
        };
      }));
    }
    return tickets;
  }

  async getTicketsByType(type: TicketType): Promise<Ticket[]> {
    const tickets = await this.getAllTickets();
    return tickets.filter(t => t.type === type);
  }

  /**
   * Server-side filter + sort + paginate for `GET /api/tickets`.
   *
   * Cursor pagination (not offset) so late inserts between page fetches don't
   * shift rows — the cursor encodes the sort key of the last row from the
   * previous page (`${sortValue}|${id}`) and we resume strictly *after* it.
   *
   * `total` is the *filtered* count so the "N shown" toolbar counter stays
   * accurate against the same filter set the client just requested.
   *
   * Priority sort preserves the client tiebreak from `+page.svelte:197-208`:
   * bug > task inside the same priority bucket.
   */
  async queryTickets(opts: TicketQueryOptions = {}): Promise<TicketQueryResult> {
    const all = await this.getAllTickets();

    // --- Filter --------------------------------------------------------------
    const q = opts.q?.trim().toLowerCase() || '';
    const filtered = all.filter(t => {
      if (opts.sprint !== undefined) {
        if (opts.sprint === 'none') {
          if (t.sprint) return false;
        } else if (t.sprint !== opts.sprint) {
          return false;
        }
      }
      if (opts.assignee !== undefined) {
        if (opts.assignee === 'none') {
          if (t.assignee) return false;
        } else if (t.assignee !== opts.assignee) {
          return false;
        }
      }
      if (opts.type !== undefined && t.type !== opts.type) return false;
      if (opts.status !== undefined && t.status !== opts.status) return false;
      if (q) {
        const hay = `${t.title} ${t.description || ''} ${t.id}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    // --- Sort ---------------------------------------------------------------
    // The comparator must be total (no ties) so the cursor cleanly resumes.
    // Tiebreak on `id` after the primary key.
    const sortBy = opts.sortBy || 'updated';
    const cmp = (a: Ticket, b: Ticket): number => {
      let primary = 0;
      switch (sortBy) {
        case 'title':
          primary = a.title.localeCompare(b.title);
          break;
        case 'created':
          primary = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          break;
        case 'priority': {
          const av = PRIORITY_ORDER[a.priority || 'medium'];
          const bv = PRIORITY_ORDER[b.priority || 'medium'];
          if (av !== bv) primary = av - bv;
          else if (a.type === 'bug' && b.type === 'task') primary = -1;
          else if (a.type === 'task' && b.type === 'bug') primary = 1;
          else primary = 0;
          break;
        }
        case 'updated':
        default:
          primary = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          break;
      }
      if (primary !== 0) return primary;
      return a.id.localeCompare(b.id);
    };
    filtered.sort(cmp);

    const total = filtered.length;

    // --- Cursor slice -------------------------------------------------------
    // Cursor is opaque to the client but shaped as `<sortValue>|<id>` under
    // the covers. `sortValue` is whatever getSortValue returns for the
    // currently active sortBy — an ISO date, a title, or a priority bucket.
    let startIdx = 0;
    if (opts.cursor) {
      const decoded = decodeCursor(opts.cursor);
      if (decoded) {
        // Linear scan is fine at the scale we care about (< 10k tickets).
        // Binary search would be a premature optimization while we're
        // still on NDJSON-in-memory.
        const idx = filtered.findIndex(t => t.id === decoded.id);
        if (idx >= 0) startIdx = idx + 1;
      }
    }

    const limit = clampLimit(opts.limit);
    const page = filtered.slice(startIdx, startIdx + limit);
    const nextIdx = startIdx + page.length;
    const nextCursor = nextIdx < filtered.length
      ? encodeCursor(page[page.length - 1], sortBy)
      : null;

    return { items: page, nextCursor, total };
  }

  // Comment CRUD (NDJSON)
  private async getCommentChunkFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.commentsDir);
      return files.filter(f => f.endsWith('.ndjson'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        await fs.mkdir(this.commentsDir, { recursive: true });
        return [];
      }
      throw error;
    }
  }

  async createComment(ticketId: string, author: string, content: string): Promise<TicketComment> {
    const now = new Date();
    const comment: TicketComment = {
      id: this.generateId('comment'),
      ticketId,
      author,
      content,
      createdAt: now,
      updatedAt: now,
    };
    const chunkFiles = await this.getCommentChunkFiles();
    let chunkFile = chunkFiles[chunkFiles.length - 1];
    if (!chunkFile) {
      chunkFile = 'comments-0001.ndjson';
    }
    const chunkPath = path.join(this.commentsDir, chunkFile);
    let count = 0;
    try {
      const content = await fs.readFile(chunkPath, 'utf8');
      count = content.split('\n').filter(line => line.trim()).length;
    } catch (error) {}
    if (count >= 1000) {
      const nextNum = chunkFiles.length + 1;
      chunkFile = `comments-${String(nextNum).padStart(4, '0')}.ndjson`;
      await fs.writeFile(path.join(this.commentsDir, chunkFile), '', 'utf8');
    }
    await fs.appendFile(path.join(this.commentsDir, chunkFile), JSON.stringify(comment) + '\n', 'utf8');
    return comment;
  }

  async getComments(ticketId: string): Promise<TicketComment[]> {
    const all = await this.getAllComments();
    return all.filter(c => c.ticketId === ticketId);
  }

  async getAllComments(): Promise<TicketComment[]> {
    const chunkFiles = await this.getCommentChunkFiles();
    let comments: TicketComment[] = [];
    for (const file of chunkFiles) {
      const content = await fs.readFile(path.join(this.commentsDir, file), 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      comments = comments.concat(lines.map(line => {
        const c = JSON.parse(line);
        return {
          ...c,
          createdAt: new Date(c.createdAt),
          updatedAt: new Date(c.updatedAt),
        };
      }));
    }
    return comments;
  }

  // Aggregate comment counts across every ticket. Cheap enough for the current
  // NDJSON layout (one pass over all chunk files, no JSON.parse per line beyond
  // a tiny field extraction), and lets the board render badges without N fetches.
  async getCommentCounts(): Promise<Record<string, number>> {
    const chunkFiles = await this.getCommentChunkFiles();
    const counts: Record<string, number> = {};
    for (const file of chunkFiles) {
      const content = await fs.readFile(path.join(this.commentsDir, file), 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const c = JSON.parse(line);
          if (c && typeof c.ticketId === 'string') {
            counts[c.ticketId] = (counts[c.ticketId] || 0) + 1;
          }
        } catch {
          // ignore malformed lines
        }
      }
    }
    return counts;
  }

  // Find ticket by ID
  async findTicket(ticketId: string): Promise<{ ticket: Ticket } | null> {
    const tickets = await this.getAllTickets();
    const ticket = tickets.find(t => t.id === ticketId);
    return ticket ? { ticket } : null;
  }

  // Find entity by ID
  async findEntity(id: string): Promise<{ entity: any, type: string } | null> {
    const tickets = await this.getAllTickets();
    const ticket = tickets.find(t => t.id === id);
    if (ticket) return { entity: ticket, type: ticket.type === 'task' ? 'tasks' : 'bugs' };
    const sprints = await this.getSprints();
    const sprint = sprints.find(s => s.id === id);
    if (sprint) return { entity: sprint, type: 'sprints' };
    const users = await this.getUsers();
    const user = users.find(u => u.id === id);
    if (user) return { entity: user, type: 'users' };
    return null;
  }

  // Delete comment by ID
  async deleteComment(commentId: string): Promise<boolean> {
    const chunkFiles = await this.getCommentChunkFiles();
    let found = false;
    for (const file of chunkFiles) {
      const filePath = path.join(this.commentsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      const filtered = lines.filter(line => {
        const c = JSON.parse(line);
        if (c.id === commentId) {
          found = true;
          return false;
        }
        return true;
      });
      await fs.writeFile(filePath, filtered.map(l => l + '\n').join(''), 'utf8');
      if (found) break;
    }
    return found;
  }

  // Delete entity by type and ID
  async deleteEntity(entityType: string, id: string): Promise<boolean> {
    switch (entityType) {
      case 'tasks':
      case 'bugs':
        return this.deleteTicket(id);
      case 'sprints':
        return (await this.deleteSprint(id)).ok;
      case 'users':
        return (await this.deleteUser(id)).deleted;
      case 'comments':
        return this.deleteComment(id);
      default:
        return false;
    }
  }

  // Delete ticket by ID
  async deleteTicket(ticketId: string): Promise<boolean> {
    const chunkFiles = await this.getTicketChunkFiles();
    let found = false;
    for (const file of chunkFiles) {
      const filePath = path.join(this.ticketsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      const filtered = lines.filter(line => {
        const t = JSON.parse(line);
        if (t.id === ticketId) {
          found = true;
          return false;
        }
        return true;
      });
      await fs.writeFile(filePath, filtered.map(l => l + '\n').join(''), 'utf8');
      if (found) break;
    }
    return found;
  }

  // Update ticket by ID
  async updateTicket(id: string, updates: Partial<Ticket>): Promise<Ticket | null> {
    const chunkFiles = await this.getTicketChunkFiles();
    let updatedTicket: Ticket | null = null;
    for (const file of chunkFiles) {
      const filePath = path.join(this.ticketsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      const newLines = lines.map(line => {
        const t = JSON.parse(line);
        if (t.id === id) {
          // Legacy 'todo' rows still exist on disk; getAllTickets rewrites them
          // to 'backlog' on read, but this write path bypasses that mapping —
          // so an assign (no status in patch) used to round-trip 'todo' back out
          // via broadcast, and the board dropped the ticket.
          if (t.status === 'todo') t.status = 'backlog';
          const next: Ticket = { ...t, ...updates, updatedAt: new Date() };
          updatedTicket = next;
          return JSON.stringify(next);
        }
        return line;
      });
      await fs.writeFile(filePath, newLines.map(l => l + '\n').join(''), 'utf8');
      if (updatedTicket) break;
    }

    // Auto-close ticket worktree when moved to done (best effort, never blocks the status change).
    const done = updatedTicket as Ticket | null;
    if (done && done.status === 'done' && done.worktree && updates.worktree === undefined) {
      const wt = done.worktree;
      try {
        if (await isGitRepo()) {
          await removeWorktree({ path: wt.path, branch: wt.branch, force: false, keepBranch: false });
          // Success — clear the reference in a second write.
          updatedTicket = await this._clearWorktreeField(id, done) || done;
        }
      } catch {
        // Worktree dirty / already gone / branch has unpushed work — leave ticket.worktree as-is
        // so the human sees "still has a worktree" and can decide.
      }
    }

    return updatedTicket;
  }

  private async _clearWorktreeField(id: string, ticket: Ticket): Promise<Ticket | null> {
    const chunkFiles = await this.getTicketChunkFiles();
    let updated: Ticket | null = null;
    for (const file of chunkFiles) {
      const filePath = path.join(this.ticketsDir, file);
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      const newLines = lines.map(line => {
        const t = JSON.parse(line);
        if (t.id === id) {
          updated = { ...t, worktree: null, updatedAt: new Date() };
          return JSON.stringify(updated);
        }
        return line;
      });
      await fs.writeFile(filePath, newLines.map(l => l + '\n').join(''), 'utf8');
      if (updated) break;
    }
    return updated;
  }

  // Update ticket status
  async updateTicketStatus(id: string, status: Ticket['status']): Promise<Ticket | null> {
    return this.updateTicket(id, { status });
  }

  // Get archived sprints (stub)
  async getArchivedSprints(): Promise<string[]> {
    return [];
  }

  // loadProject (no-op for JSON)
  async loadProject(): Promise<void> {
    return;
  }
}

export const createStorage = async (): Promise<ProjectStorage> => {
  return new ProjectStorage();
};