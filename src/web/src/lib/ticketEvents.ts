// Shared subscription bus for `ticket_*` WebSocket events.
//
// Panels that own their own data slice (SprintPanel, UserPanel, CommandPalette,
// TicketPanel dep picker, Sidebar summary) need to refetch when tickets change
// server-side — but ONLY while the panel is open. Rather than each of them
// opening a duplicate WebSocket to `${wsProto}//${host}`, this module maintains
// a single lazily-created connection shared across all subscribers. The socket
// is torn down as soon as the last subscriber unsubscribes, so closed panels
// impose zero ambient traffic (see tas-z-8q_Ljc).
//
// Usage from a panel:
//   import { onTicketEvent } from './ticketEvents';
//   onMount(() => onTicketEvent(() => refetch()));
//
// The unsubscribe returned by `onTicketEvent` is Svelte-onMount-compatible
// (return it directly from the onMount callback).

import { browser } from '$app/environment';

type Listener = (evt: { type: string; data?: any }) => void;

let ws: WebSocket | null = null;
let reconnectTimer: number | null = null;
const listeners = new Set<Listener>();

function connect() {
  if (!browser) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  try {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${window.location.host}`);
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (!m || typeof m.type !== 'string') return;
        // Only forward ticket_* mutations. comment_*/sprint_*/user_* fire their
        // own downstream refreshes elsewhere; panels here care about ticket data.
        if (!m.type.startsWith('ticket_')) return;
        for (const fn of listeners) {
          try { fn(m); } catch { /* isolate one bad listener from the rest */ }
        }
      } catch { /* noop */ }
    };
    ws.onclose = () => {
      ws = null;
      // Reconnect only while someone is still listening. If listeners drained
      // during the close race, let the socket stay closed until a new mount.
      if (listeners.size > 0) {
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 3000);
      }
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* noop */ } };
  } catch { /* noop */ }
}

function disconnect() {
  if (reconnectTimer) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch { /* noop */ } ws = null; }
}

/**
 * Subscribe to `ticket_*` WebSocket events. Returns an unsubscribe function
 * suitable for direct return from Svelte's `onMount` callback.
 */
export function onTicketEvent(fn: Listener): () => void {
  listeners.add(fn);
  if (listeners.size === 1) connect();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) disconnect();
  };
}
