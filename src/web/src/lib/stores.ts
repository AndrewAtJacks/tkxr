import { writable } from 'svelte/store';

export interface Ticket {
  id: string;
  type: 'task' | 'bug';
  title: string;
  description?: string;
  status: 'todo' | 'progress' | 'done';
  assignee?: string;
  sprint?: string;
  estimate?: number;
  labels?: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
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
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  createdAt: string;
  updatedAt: string;
}

export const ticketStore = writable<Ticket[]>([]);
export const sprintStore = writable<Sprint[]>([]);
export const userStore = writable<User[]>([]);