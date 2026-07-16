import { promises as fs } from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import type { Ticket, Sprint, User, TicketType, TicketComment } from './types.js';
import { isGitRepo, removeWorktree } from './worktree.js';

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

  async deleteUser(userId: string): Promise<boolean> {
    const users = await this.getUsers();
    const index = users.findIndex(u => u.id === userId);
    if (index === -1) return false;
    users.splice(index, 1);
    await fs.writeFile(this.usersPath, JSON.stringify(users, null, 2), 'utf8');
    return true;
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

  async deleteSprint(sprintId: string): Promise<boolean> {
    const sprints = await this.getSprints();
    const index = sprints.findIndex(s => s.id === sprintId);
    if (index === -1) return false;
    sprints.splice(index, 1);
    await fs.writeFile(this.sprintsPath, JSON.stringify(sprints, null, 2), 'utf8');
    return true;
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
        return this.deleteSprint(id);
      case 'users':
        return this.deleteUser(id);
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