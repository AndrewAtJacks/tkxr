import { derived, writable, type Readable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { claudeConfig } from './stores';

// User-controlled UI preferences persisted to localStorage. Distinct from
// `claudeConfig` (server-reported capability) — this file owns the *user's*
// choices about how the UI should behave, regardless of what the server can do.
//
// Currently: a single toggle that forces the "copy prompt to clipboard" fallback
// even when the claude CLI is available on the server. Added because users may
// prefer the paste-into-terminal flow (e.g. their local claude session is
// already primed) over the server-spawned CLI runs.

const KEY = 'tkxr-settings';

interface Settings {
  cliDisabled: boolean;
}

function loadInitial(): Settings {
  if (!browser) return { cliDisabled: false };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { cliDisabled: false };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { cliDisabled: !!parsed.cliDisabled };
  } catch {
    return { cliDisabled: false };
  }
}

function persist(s: Settings) {
  if (!browser) return;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* noop */ }
}

function createCliDisabled(): Writable<boolean> {
  const initial = loadInitial().cliDisabled;
  const { subscribe, set, update } = writable<boolean>(initial);
  return {
    subscribe,
    set(v: boolean) {
      persist({ cliDisabled: v });
      set(v);
    },
    update(fn) {
      update(cur => {
        const next = fn(cur);
        persist({ cliDisabled: next });
        return next;
      });
    },
  };
}

export const cliDisabled = createCliDisabled();

/**
 * Effective CLI availability. `true` only when the server reports the binary
 * available AND the user hasn't force-disabled the CLI in settings. All UI
 * that used to branch on `$claudeConfig?.available` should read this instead —
 * that way the copy-paste fallback path is honored whether the CLI is missing
 * or the user simply prefers not to use it.
 */
export const claudeAvailable: Readable<boolean> = derived(
  [claudeConfig, cliDisabled],
  ([$cfg, $disabled]) => !!$cfg?.available && !$disabled,
);
