import { writable } from 'svelte/store';

export type TicketStatus = 'backlog' | 'progress' | 'review' | 'blocked' | 'done';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TicketWorktree {
  path: string;
  branch: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  type: 'task' | 'bug';
  title: string;
  description?: string;
  status: TicketStatus;
  assignee?: string | null;
  sprint?: string | null;
  estimate?: number;
  labels?: string[];
  priority?: TicketPriority;
  worktree?: TicketWorktree | null;
  dependsOn?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TicketComment {
  id: string;
  ticketId: string;
  author: string; // User ID
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface Sprint {
  id: string;
  name: string;
  description?: string;
  status: 'planning' | 'active' | 'completed';
  startDate?: string;
  endDate?: string;
  goal?: string;
  worktree?: TicketWorktree | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export const ticketStore = writable<Ticket[]>([]);
export const sprintStore = writable<Sprint[]>([]);
export const userStore = writable<User[]>([]);