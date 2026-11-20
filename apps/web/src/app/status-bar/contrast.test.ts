/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { oklchContrast } from '@/test/contrast';

// Vitest empties CSS imports, so the stylesheet is read as text.
const css = readFileSync(resolve(import.meta.dirname, '../../index.css'), 'utf8');

/** The `--token: value` pairs of the rule whose selector list ends with `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]),
  ) as Record<string, string>;
}

const themes = {
  dark: tokens(":root[data-theme='dark']"),
  light: tokens(":root[data-theme='light']"),
};

// The status bar sets 11 px text, so the AA bound for normal text applies. Light passes narrowly,
// which gives two rules: the bar is `bg-background`, never `bg-sidebar` (muted text on it is 4.53),
// and a segment's hover and open state switch to `text-foreground` (muted on `bg-muted` is 4.34).
describe.each(Object.entries(themes))('status bar contrast, %s theme', (_name, theme) => {
  const token = (name: string) => {
    const value = theme[name];
    if (value === undefined) throw new Error(`no ${name}`);
    return value;
  };

  it.each([
    ['--muted-foreground', '--background'],
    ['--foreground', '--muted'],
    ['--foreground', '--accent'],
    ['--destructive', '--background'],
  ])('%s on %s is at least 4.5', (foreground, background) => {
    expect(oklchContrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });
});
