import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { nanoid } from 'nanoid';
import type { Ticket, Sprint, User, TicketType } from './types.js';

export class FileStorage {
  constructor(private basePath: string = './tickets') {}

  private getEntityPath(type: string, id?: string): string {
    const basePath = path.resolve(this.basePath);
    if (id) {
      return path.join(basePath, type, `${id}.yaml`);
    }
    return path.join(basePath, type);
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  private generateId(type: string): string {
    const prefix = type.substring(0, 3);
    const id = nanoid(8);
    return `${prefix}-${id}`;
  }

  async saveEntity<T extends { id: string }>(type: string, entity: T): Promise<void> {
    const filePath = this.getEntityPath(type, entity.id);
    await this.ensureDirectoryExists(path.dirname(filePath));
    
    const yamlContent = yaml.dump(entity, { 
      indent: 2,
      lineWidth: 120,
      forceQuotes: false,
    });
    
    await fs.writeFile(filePath, yamlContent, 'utf8');
  }

  async loadEntity<T>(type: string, id: string): Promise<T | null> {
    try {
      const filePath = this.getEntityPath(type, id);
      const content = await fs.readFile(filePath, 'utf8');
      return yaml.load(content) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async deleteEntity(type: string, id: string): Promise<boolean> {
    try {
      const filePath = this.getEntityPath(type, id);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  async listEntities<T>(type: string): Promise<T[]> {
    try {
      const dirPath = this.getEntityPath(type);
      const files = await fs.readdir(dirPath);
      const yamlFiles = files.filter(file => file.endsWith('.yaml'));
      
      const entities: T[] = [];
      for (const file of yamlFiles) {
        const filePath = path.join(dirPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        const entity = yaml.load(content) as T;
        entities.push(entity);
      }
      
      return entities;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
      status: 'todo',
      createdAt: now,
      updatedAt: now,
      ...options,
    };

    await this.saveEntity(`${type}s`, ticket);
    return ticket;
  }

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

    await this.saveEntity('sprints', sprint);
    return sprint;
  }

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

    await this.saveEntity('users', user);
    return user;
  }

  async updateTicketStatus(id: string, status: Ticket['status']): Promise<Ticket | null> {
    // Try to find the ticket in tasks or bugs
    let ticket = await this.loadEntity<Ticket>('tasks', id);
    let entityType = 'tasks';
    
    if (!ticket) {
      ticket = await this.loadEntity<Ticket>('bugs', id);
      entityType = 'bugs';
    }

    if (!ticket) {
      return null;
    }

    ticket.status = status;
    ticket.updatedAt = new Date();
    
    await this.saveEntity(entityType, ticket);
    return ticket;
  }

  async updateSprintStatus(id: string, status: Sprint['status']): Promise<Sprint | null> {
    const sprint = await this.loadEntity<Sprint>('sprints', id);
    
    if (!sprint) {
      return null;
    }

    sprint.status = status;
    sprint.updatedAt = new Date();
    
    await this.saveEntity('sprints', sprint);
    return sprint;
  }

  async getTicketsByType(type: TicketType): Promise<Ticket[]> {
    return this.listEntities<Ticket>(`${type}s`);
  }

  async getAllTickets(): Promise<Ticket[]> {
    const tasks = await this.getTicketsByType('task');
    const bugs = await this.getTicketsByType('bug');
    return [...tasks, ...bugs];
  }

  async getSprints(): Promise<Sprint[]> {
    return this.listEntities<Sprint>('sprints');
  }

  async getUsers(): Promise<User[]> {
    return this.listEntities<User>('users');
  }
}