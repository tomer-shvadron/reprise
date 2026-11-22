import { describe, expect, it } from 'vitest';

import { contrastRatio } from './contrast';
import { over, paint, theme, tintedContrast, tokenContrast, type ThemeName } from './theme-tokens';

// WP-100 (#311): the contrast of the pairs the chrome and the score depend on, in both themes.
// Text is held to WCAG AA 4.5 (the status bar sets 11 px text); a mark that is not text, such as
// the cursor or the focus ring, to the 3 of success criterion 1.4.11. Borders and disabled
// controls are exempt: a border only decorates, and WCAG excludes inactive components.
//
// Rules the pairs back (they held when the tokens were tighter, and now have margin):
// - the status bar is `bg-background`, and its segments go to `text-foreground` on hover and when
//   open (`--foreground` on `--muted` and `--accent`);
// - the palette's hint row and a row's detail are 12 px: muted on the popover, and foreground on the
//   selected row's `bg-muted`;
// - `muted-on-accent` in index.css uses the sidebar-accent muted foreground.
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

// `--ring` here is the solid focus indicator (`ring-ring`, `border-ring`, `outline-ring`).
const MARKS: [string, string][] = [
  ['--ring', '--background'],
  ['--paper-accent', '--paper'],
  ['--arpeggio', '--background'],
  ['--arpeggio', '--sidebar'],
];

// What identifies an input or an off switch: the light `--input` is split from the decorative
// `--border`. Dark tells them apart by the white thumb and the translucent fill instead.
const LIGHT_INPUT_MARKS: [string, string][] = [
  ['--input', '--background'],
  ['--input', '--sidebar'],
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

  // The halo alone (`ring-ring/50`) is about 1.85:1, under 1.4.11's 3:1, so a component that draws
  // only a halo fails. The solid indicator is the `--ring` mark above; focus-indicator.test.ts
  // pins which components draw it.
  it('the 50% halo alone would not meet 3, which is why the indicator is solid', () => {
    const halo = { rgb: paint(values, '--ring').rgb, alpha: 0.5 };
    const background = paint(values, '--background').rgb;
    expect(contrastRatio(over(halo, background), background)).toBeLessThan(3);
  });

  it.each(OVERLAYS)('score ink stays at least 7 under the %s overlay', (_overlay, alpha) => {
    const tint = { rgb: paint(values, '--paper-accent').rgb, alpha };
    expect(tintedContrast(values, '--ink', tint, '--paper')).toBeGreaterThanOrEqual(7);
  });
});

describe('theme contrast, light inputs', () => {
  const values = theme('light');
  it.each(LIGHT_INPUT_MARKS)('mark %s on %s is at least 3', (fg, bg) => {
    expect(tokenContrast(values, fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
