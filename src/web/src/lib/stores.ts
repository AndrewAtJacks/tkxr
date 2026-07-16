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

// Server-reported claude CLI probe result. `null` until `/api/config` responds.
// Populated in the boot fetch inside `+page.svelte`. Downstream tickets
// (tas-T8ZXseeD, G7GkoInt, 3Rto4I82, 1xjZ4qLb) will read this to branch
// between "Run in Claude" and the existing `copyPrompt` clipboard fallback
// in `src/web/src/lib/clipboard.ts`. See docs/claude-cli-integration.md §5.
//
// When `available === false` (or the store is still `null` at click time)
// the UI must fall back to `copyPrompt`. When the server later returns
// `503 { code: 'claude_unavailable' }` on a run attempt, that helper will
// also flip `available` to `false` locally so subsequent clicks skip the
// round-trip.
export interface ClaudeConfig {
  available: boolean;
  bin: string;
  version?: string;
  disabled?: boolean;
}
export const claudeConfig = writable<ClaudeConfig | null>(null);