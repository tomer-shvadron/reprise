import { describe, expect, it } from 'vitest';

import { paint, theme, tintedContrast, tokenContrast, type ThemeName } from './theme-tokens';

// WP-100 (#311): the contrast of the pairs the chrome and the score depend on, in both themes.
// Text is held to WCAG AA 4.5 (the status bar sets 11 px text); a mark that is not text, such as
// the cursor or the focus ring, to the 3 of success criterion 1.4.11. Borders and disabled
// controls are exempt: a border only decorates, and WCAG excludes inactive components.
const TEXT: [string, string][] = [
  ['--foreground', '--background'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--card'],
  ['--muted-foreground', '--popover'],
  ['--muted-foreground', '--muted'],
  ['--foreground', '--muted'],
  ['--foreground', '--accent'],
  ['--sidebar-foreground', '--sidebar'],
  ['--sidebar-accent-muted-foreground', '--sidebar-accent'],
  ['--primary-foreground', '--primary'],
  ['--destructive', '--background'],
  ['--mute-foreground', '--mute'],
  ['--solo-foreground', '--solo'],
  ['--success', '--background'],
  ['--success', '--sidebar'],
  ['--ink', '--paper'],
  ['--ink-muted', '--paper'],
];

const MARKS: [string, string][] = [
  ['--ring', '--background'],
  ['--paper-accent', '--paper'],
  ['--arpeggio', '--background'],
  ['--arpeggio', '--sidebar'],
];

// The score's translucent overlays, from `score.css`, as the share of the accent they lay down.
const OVERLAYS: [string, number][] = [
  ['selection', 0.22],
  ['range', 0.18],
  ['caret', 0.35],
  ['highlight', 0.12],
];

describe.each<ThemeName>(['dark', 'light'])('theme contrast, %s', (name) => {
  const values = theme(name);

  it.each(TEXT)('text %s on %s is at least 4.5', (fg, bg) => {
    expect(tokenContrast(values, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(MARKS)('mark %s on %s is at least 3', (fg, bg) => {
    expect(tokenContrast(values, fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it.each(OVERLAYS)('score ink stays at least 7 under the %s overlay', (_overlay, alpha) => {
    const tint = { rgb: paint(values, '--paper-accent').rgb, alpha };
    expect(tintedContrast(values, '--ink', tint, '--paper')).toBeGreaterThanOrEqual(7);
  });
});
