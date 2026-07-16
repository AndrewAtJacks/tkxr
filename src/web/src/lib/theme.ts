import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type Theme = 'dark' | 'light';

const KEY = 'tkxr-theme';

function getInitial(): Theme {
  if (!browser) return 'dark';
  const saved = localStorage.getItem(KEY);
  if (saved === 'light' || saved === 'dark') return saved;
  return 'dark';
}

function apply(theme: Theme) {
  if (!browser) return;
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
}

function create() {
  const initial = getInitial();
  if (browser) apply(initial);
  const { subscribe, set, update } = writable<Theme>(initial);
  return {
    subscribe,
    set: (t: Theme) => {
      if (browser) {
        localStorage.setItem(KEY, t);
        apply(t);
      }
      set(t);
    },
    toggle: () =>
      update(prev => {
        const next: Theme = prev === 'dark' ? 'light' : 'dark';
        if (browser) {
          localStorage.setItem(KEY, next);
          apply(next);
        }
        return next;
      }),
  };
}

export const theme = create();
