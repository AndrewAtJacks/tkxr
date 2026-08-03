/**
 * Epic colors are interpolated straight into `style="background:{color}"` by
 * the web client (Sidebar / BoardCard / ListView). Svelte escapes the attribute
 * so a value cannot break out of it, but an unconstrained string still lets
 * extra declarations ride along — `red;position:fixed;inset:0` would be applied
 * verbatim. Every write path constrains the field to a hex literal, the way the
 * status field beside it is constrained to `EpicStatus` (tas-nuu2zscR).
 */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const COLOR_ERROR = 'color must be a hex literal like #4c8dff';

export function isValidColor(color: unknown): color is string {
  return typeof color === 'string' && HEX_COLOR.test(color);
}

/** The error message when `color` is invalid, or null when it's fine. */
export function badColorRef(color: unknown): string | null {
  return isValidColor(color) ? null : COLOR_ERROR;
}
