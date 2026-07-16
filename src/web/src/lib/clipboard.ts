import { writable } from 'svelte/store';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export const toasts = writable<Toast[]>([]);

let nextId = 1;

export function showToast(text: string, kind: Toast['kind'] = 'info', ms = 2400) {
  const id = nextId++;
  toasts.update(list => [...list, { id, text, kind }]);
  setTimeout(() => {
    toasts.update(list => list.filter(t => t.id !== id));
  }, ms);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export async function copyPrompt(prompt: string, label = 'Prompt copied — paste into Claude Code') {
  const ok = await copyToClipboard(prompt);
  showToast(ok ? label : 'Copy failed — clipboard blocked?', ok ? 'success' : 'error');
}
