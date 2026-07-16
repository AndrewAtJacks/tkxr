import type { Sprint, Ticket, TicketPriority, TicketStatus, User } from './stores';

export const AVATAR_PALETTE = ['#4c8dff', '#3aa76a', '#e0864a', '#b06bd6', '#d6689b', '#46b0c1', '#c1a13a'];

export function avatarColorFor(u: Pick<User, 'id' | 'color'>, index = 0): string {
  return u.color || AVATAR_PALETTE[index % AVATAR_PALETTE.length];
}

export function initials(name: string | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]).join('').toUpperCase();
}

export function sprintDotColor(status: Sprint['status'] | string | undefined): string {
  if (status === 'active') return '#46c17f';
  if (status === 'completed') return '#8b93a1';
  return '#f2b544';
}

export const STATUS_ORDER: TicketStatus[] = ['backlog', 'progress', 'review', 'blocked', 'done'];

export const STATUS_LABEL: Record<TicketStatus, string> = {
  backlog: 'Backlog',
  progress: 'In Progress',
  review: 'In Review',
  blocked: 'Blocked',
  done: 'Done',
};

export const STATUS_COLOR: Record<TicketStatus, string> = {
  backlog: '#8b93a1',
  progress: '#f2b544',
  review: '#4c8dff',
  blocked: '#ff6b6b',
  done: '#46c17f',
};

export function statusTint(status: TicketStatus, alpha = 0.06): string {
  const hex = STATUS_COLOR[status];
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const PRIORITY_META: Record<TicketPriority, { label: string; color: string; bg: string }> = {
  low: { label: 'Low', color: '#5b93ff', bg: 'rgba(91,147,255,.14)' },
  medium: { label: 'Med', color: '#f2b544', bg: 'rgba(242,181,68,.14)' },
  high: { label: 'High', color: '#ff9f45', bg: 'rgba(255,159,69,.14)' },
  critical: { label: 'Crit', color: '#ff6b6b', bg: 'rgba(255,107,107,.14)' },
};

export const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function normalizeTicket(t: any): Ticket {
  const status = t.status === 'todo' ? 'backlog' : t.status;
  return { ...t, status };
}

export function relativeTime(iso: string | Date): string {
  const then = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  const s = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
}
