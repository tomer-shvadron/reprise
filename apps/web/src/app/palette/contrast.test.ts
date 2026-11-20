/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { oklchContrast } from '@/test/contrast';

const css = readFileSync(resolve(import.meta.dirname, '../../index.css'), 'utf8');

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]),
  ) as Record<string, string>;
}

// The hint row and a row's detail are 12 px text: muted on the popover, and foreground on the
// selected row's `bg-muted`, since muted on muted falls under 4.5 in the light theme.
describe.each(['dark', 'light'])('palette contrast, %s theme', (name) => {
  const theme = tokens(`:root[data-theme='${name}']`);
  const token = (key: string) => {
    const value = theme[key];
    if (value === undefined) throw new Error(`no ${key}`);
    return value;
  };

  it.each([
    ['--muted-foreground', '--popover'],
    ['--foreground', '--muted'],
  ])('%s on %s is at least 4.5', (foreground, background) => {
    expect(oklchContrast(token(foreground), token(background))).toBeGreaterThanOrEqual(4.5);
  });
});
