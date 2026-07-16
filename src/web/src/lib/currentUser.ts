import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import type { User } from './stores';

// Persistent identity of the operator sitting in front of the browser. Distinct
// from any board filters — nothing in the UI implicitly changes just because
// this changes; it just controls the default author on new comments and the
// default assignee on new tickets so we stop silently attributing things to
// users[0].

const KEY = 'tkxr-current-user';

function getInitial(): string | null {
  if (!browser) return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function create() {
  const { subscribe, set } = writable<string | null>(getInitial());
  return {
    subscribe,
    set: (id: string | null) => {
      if (browser) {
        try {
          if (id) localStorage.setItem(KEY, id);
          else localStorage.removeItem(KEY);
        } catch { /* noop */ }
      }
      set(id);
    },
  };
}

export const currentUserId = create();

// Resolve the current user against a fresh users list. Falls back to null if
// the stored id no longer exists (deleted user, cleared localStorage, etc).
// Callers that need a hard fallback (e.g. commenting) can chain `?? users[0]`.
export function resolveCurrentUser(users: User[], id: string | null): User | null {
  if (!id) return null;
  return users.find(u => u.id === id) || null;
}
