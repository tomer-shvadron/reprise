import type { PaletteMode } from './types';

export interface ParsedQuery {
  mode: PaletteMode;
  /** What the mode's provider searches for: the input without its prefix, trimmed. */
  text: string;
}

const PREFIXES: Record<string, PaletteMode> = {
  '>': 'commands',
  '#': 'sections',
  '@': 'tracks',
  '/': 'songs',
};

/**
 * The first character picks the mode, so the mode is visible in the input and Backspace clears it.
 * Only digits make a bar number; "12a" and ">12" are commands.
 */
export function parseQuery(input: string): ParsedQuery {
  const text = input.trimStart();
  const first = text.charAt(0);
  const mode = PREFIXES[first];
  if (mode !== undefined) return { mode, text: text.slice(1).trim() };
  const trimmed = text.trim();
  if (/^\d{1,6}$/u.test(trimmed)) return { mode: 'bar', text: trimmed };
  return { mode: 'commands', text: trimmed };
}
