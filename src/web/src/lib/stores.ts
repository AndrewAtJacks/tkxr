import { derived, get, writable, type Readable, type Writable } from 'svelte/store';
import { normalizeTicket } from './util';

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

// ---------------------------------------------------------------------------
// Paged ticket store (tas-RYc3-yIM)
// ---------------------------------------------------------------------------
// Wraps the paged `GET /api/tickets?...` shape from tas-AEduZ-wc. Server returns
//   `{ items: Ticket[], nextCursor: string|null, total: number }`
// whenever any of `limit | cursor | q | sprint | assignee | type | status |
// sortBy` are present, otherwise a legacy `Ticket[]`. This store *always* sends
// at least one paging param (`limit`) so it consistently gets the paged shape.
//
// The store is intentionally consumer-friendly:
//   - Each field is exposed as its own `Readable<T>` so panels can subscribe to
//     just what they need (e.g. Board columns can each own a store for their
//     own status; a triage view might only care about `total`).
//   - The mutation surface is a small set of imperative helpers, not writable
//     stores, so consumers can't accidentally desync `items` from `nextCursor`.
//
// Downstream infinite-scroll tickets (Board / ListView wiring) instantiate
// `createPagedTicketStore()` per column; the default page uses the exported
// singleton `pagedTickets`.

export type TicketSortBy = 'updated' | 'created' | 'priority' | 'title';

export interface PagedTicketQuery {
  q?: string;
  /** Sprint id, the literal `'none'` for tickets with no sprint, or omitted. */
  sprint?: string;
  /** User id, the literal `'none'` for unassigned tickets, or omitted. */
  assignee?: string;
  type?: 'task' | 'bug';
  status?: TicketStatus;
  sortBy?: TicketSortBy;
  /** Page size. Defaults to 50 (server default), capped at 200 (server). */
  limit?: number;
}

/** Discriminated union matching the WS event types broadcast by serve.ts. */
export type TicketEvent =
  | { type: 'ticket_created'; data: Ticket }
  | { type: 'ticket_updated'; data: Ticket }
  | { type: 'ticket_deleted'; data: { id: string } };

export interface PagedTicketStore {
  /** Current page's items. Grows as `fetchNextPage()` appends. */
  items: Readable<Ticket[]>;
  /** Opaque cursor for the next page, or `null` if the last page has been fetched. */
  nextCursor: Readable<string | null>;
  /** Server-reported total matching the current query (unaffected by paging). */
  total: Readable<number>;
  /** True while a fetch (either reset or next page) is in-flight. */
  loading: Readable<boolean>;
  /** Last error message from a failed fetch, cleared on the next successful fetch. */
  error: Readable<string | null>;
  /** The currently-applied query. Mutated only by `resetAndFetch`. */
  query: Readable<PagedTicketQuery>;
  /** True while any page beyond the first has been fetched. */
  hasMore: Readable<boolean>;

  /**
   * Replace the query, clear items, and load page 1. Idempotent — safe to
   * call on every filter change. Discards any in-flight fetch's results.
   */
  resetAndFetch(query: PagedTicketQuery): Promise<void>;
  /**
   * Load the next page and append to `items`. No-op if `nextCursor` is null
   * or a fetch is already in-flight.
   */
  fetchNextPage(): Promise<void>;
  /**
   * Apply a WebSocket ticket event to the local page. Keeps the visible page
   * in sync without a full refetch:
   *   - `ticket_created`: if it matches the current query, prepend and bump total
   *   - `ticket_updated`: replace in place if present; drop if it no longer
   *      matches the current query; total unchanged (server would re-broadcast)
   *   - `ticket_deleted`: remove by id and decrement total
   *
   * Consumers wire this into their WS handler; the store is intentionally not
   * self-subscribing so tests and headless usage stay simple.
   */
  applyEvent(evt: TicketEvent): void;
  /**
   * Snapshot the current items. Useful for legacy consumers that still expect
   * an array. Prefer the `items` store where possible.
   */
  snapshot(): Ticket[];
}

interface InternalState {
  items: Ticket[];
  nextCursor: string | null;
  total: number;
  loading: boolean;
  error: string | null;
  query: PagedTicketQuery;
}

function buildQueryString(q: PagedTicketQuery, cursor: string | null): string {
  const params = new URLSearchParams();
  // Always send `limit` so the server picks the paged response shape even when
  // no filters are active. 50 matches the server default; sending it makes the
  // "did the server pick paged vs legacy?" decision deterministic client-side.
  params.set('limit', String(q.limit ?? 50));
  if (cursor) params.set('cursor', cursor);
  if (q.q) params.set('q', q.q);
  if (q.sprint) params.set('sprint', q.sprint);
  if (q.assignee) params.set('assignee', q.assignee);
  if (q.type) params.set('type', q.type);
  if (q.status) params.set('status', q.status);
  if (q.sortBy) params.set('sortBy', q.sortBy);
  return params.toString();
}

/**
 * Does a ticket match the current UI filter? Mirrors the server's filter
 * predicate closely enough to keep `applyEvent` from showing stale rows. The
 * server is the source of truth — this is a best-effort filter so that WS
 * events for tickets outside the current view don't briefly appear.
 */
function ticketMatchesQuery(t: Ticket, q: PagedTicketQuery): boolean {
  if (q.sprint) {
    if (q.sprint === 'none') { if (t.sprint) return false; }
    else if (t.sprint !== q.sprint) return false;
  }
  if (q.assignee) {
    if (q.assignee === 'none') { if (t.assignee) return false; }
    else if (t.assignee !== q.assignee) return false;
  }
  if (q.type && t.type !== q.type) return false;
  if (q.status && t.status !== q.status) return false;
  if (q.q) {
    const needle = q.q.toLowerCase();
    const hay = `${t.title} ${t.description || ''} ${t.id}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

export function createPagedTicketStore(): PagedTicketStore {
  const state: Writable<InternalState> = writable({
    items: [],
    nextCursor: null,
    total: 0,
    loading: false,
    error: null,
    query: {},
  });

  // Monotonic fetch id so a stale in-flight response can't overwrite fresher
  // state when the user rapidly changes filters.
  let fetchSeq = 0;

  async function doFetch(query: PagedTicketQuery, cursor: string | null, append: boolean): Promise<void> {
    const seq = ++fetchSeq;
    state.update(s => ({ ...s, loading: true, error: null, query }));
    try {
      const qs = buildQueryString(query, cursor);
      const res = await fetch(`/api/tickets?${qs}`);
      if (!res.ok) throw new Error(`GET /api/tickets ${res.status}`);
      const body = await res.json();
      // Defensive: if the server took the legacy path (shouldn't happen because
      // we always send `limit`), fall back gracefully.
      const items: Ticket[] = Array.isArray(body)
        ? body.map(normalizeTicket)
        : (body.items || []).map(normalizeTicket);
      const nextCursor: string | null = Array.isArray(body) ? null : (body.nextCursor ?? null);
      const total: number = Array.isArray(body) ? items.length : (body.total ?? items.length);

      if (seq !== fetchSeq) return; // superseded; drop
      state.update(s => ({
        ...s,
        items: append ? [...s.items, ...items] : items,
        nextCursor,
        total,
        loading: false,
        error: null,
      }));
    } catch (err) {
      if (seq !== fetchSeq) return;
      const message = err instanceof Error ? err.message : String(err);
      state.update(s => ({ ...s, loading: false, error: message }));
    }
  }

  return {
    items: derived(state, s => s.items),
    nextCursor: derived(state, s => s.nextCursor),
    total: derived(state, s => s.total),
    loading: derived(state, s => s.loading),
    error: derived(state, s => s.error),
    query: derived(state, s => s.query),
    hasMore: derived(state, s => s.nextCursor !== null),

    async resetAndFetch(query: PagedTicketQuery) {
      // Clear items eagerly so the UI shows an empty/loading state during the
      // fetch rather than briefly rendering the previous filter's items.
      state.update(s => ({ ...s, items: [], nextCursor: null, total: 0 }));
      await doFetch(query, null, false);
    },

    async fetchNextPage() {
      const s = get(state);
      if (s.loading || s.nextCursor === null) return;
      await doFetch(s.query, s.nextCursor, true);
    },

    applyEvent(evt: TicketEvent) {
      state.update(s => {
        if (evt.type === 'ticket_deleted') {
          const idx = s.items.findIndex(t => t.id === evt.data.id);
          if (idx < 0) return s;
          const items = [...s.items.slice(0, idx), ...s.items.slice(idx + 1)];
          return { ...s, items, total: Math.max(0, s.total - 1) };
        }
        const t = normalizeTicket(evt.data);
        if (evt.type === 'ticket_created') {
          if (!ticketMatchesQuery(t, s.query)) return s;
          // Prepend — the currently active sort is server-side, so putting new
          // rows at the top matches the common `sortBy: updated` case. If a
          // different sort is active the next refresh will reorder correctly.
          return { ...s, items: [t, ...s.items], total: s.total + 1 };
        }
        // ticket_updated
        const idx = s.items.findIndex(x => x.id === t.id);
        const matches = ticketMatchesQuery(t, s.query);
        if (idx >= 0) {
          if (!matches) {
            // Ticket moved out of the current view (e.g. status changed on a
            // status-filtered column). Drop it; the server-side total is not
            // authoritative for this transition — a follow-up summary refetch
            // by the caller will reconcile.
            const items = [...s.items.slice(0, idx), ...s.items.slice(idx + 1)];
            return { ...s, items, total: Math.max(0, s.total - 1) };
          }
          const items = [...s.items];
          items[idx] = t;
          return { ...s, items };
        }
        // Ticket wasn't in our page but now matches — could be scrolled below
        // our current cursor. Don't inject; let the next `fetchNextPage` or
        // `resetAndFetch` pick it up. Bumping total here would double-count.
        return s;
      });
    },

    snapshot() {
      return get(state).items;
    },
  };
}

/**
 * Default paged store used by the top-level page. Board columns / infinite
 * scroll wiring in downstream tickets can create their own via the factory.
 */
export const pagedTickets: PagedTicketStore = createPagedTicketStore();

// Legacy full-list store. Downstream ticket tas-z-8q_Ljc decouples panels
// (TicketPanel, CommandPalette, SprintPanel, UserPanel, TriagePanel) from
// this store. Until then, we mirror `pagedTickets.items` into it so those
// panels keep receiving data. This is a *view* over the current page, not
// a full snapshot of the server dataset — that's intentional now that the
// server is authoritative for filtering/sorting.
export const ticketStore = writable<Ticket[]>([]);
pagedTickets.items.subscribe(items => ticketStore.set(items));

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
export type ClaudePermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';

export interface ClaudeConfig {
  available: boolean;
  bin: string;
  version?: string;
  disabled?: boolean;
  /** Non-interactive permission mode the runner passes to `claude --permission-mode`. */
  permissionMode?: ClaudePermissionMode;
}
export const claudeConfig = writable<ClaudeConfig | null>(null);
