import { writable } from 'svelte/store';

export const draggingTicketId = writable<string | null>(null);
