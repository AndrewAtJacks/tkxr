export type TicketType = 'task' | 'bug';
export type SprintStatus = 'planning' | 'active' | 'completed';
export type TicketStatus = 'backlog' | 'progress' | 'review' | 'blocked' | 'done';

export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User extends BaseEntity {
  username: string;
  displayName: string;
  email?: string;
  color?: string;
}

export interface Sprint extends BaseEntity {
  name: string;
  description?: string;
  status: SprintStatus;
  startDate?: Date;
  endDate?: Date;
  goal?: string;
  worktree?: TicketWorktree | null;
}

export interface TicketWorktree {
  path: string;
  branch: string;
  createdAt: string;
}

export interface Ticket extends BaseEntity {
  type: TicketType;
  title: string;
  description?: string;
  status: TicketStatus;
  assignee?: string; // User ID
  sprint?: string; // Sprint ID
  estimate?: number; // Story points or hours
  labels?: string[];
  priority?: 'low' | 'medium' | 'high' | 'critical';
  worktree?: TicketWorktree | null;
  dependsOn?: string[]; // Ticket IDs this ticket blocks on
}

export interface TicketComment extends BaseEntity {
  ticketId: string;
  author: string; // User ID
  content: string;
}

export interface ProjectConfig {
  name: string;
  defaultSprint?: string;
  users: User[];
  settings: {
    useStoryPoints: boolean;
    defaultPriority: Ticket['priority'];
    allowedLabels?: string[];
  };
}

export interface ProjectData {
  version: string;
  project: {
    name: string;
    created: Date;
    updated: Date;
  };
  users: User[];
  sprints: Sprint[];
  tickets: Ticket[];
  comments: TicketComment[];
}

export interface ArchivedSprintData {
  version: string;
  sprint: Sprint;
  tickets: Ticket[];
  comments: TicketComment[];
  archivedAt: Date;
}