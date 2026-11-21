import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PAGE_SIZES } from '@reprise/layout';
import { describe, expect, it } from 'vitest';

import css from './score.css?raw';

/** A colour literal: hex, a colour function, or a named colour (not part of a word like `white-space`). */
const LITERAL =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|(?<![-\w])(?:black|white|red|green|blue|gray|grey|yellow|orange|purple|pink|brown|cyan|magenta)(?![-\w])/i;

describe('score.css', () => {
  it('names no colour: every colour is a score token from the theme', () => {
    const withoutComments = css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
    const withoutMixes = withoutComments.replaceAll(/color-mix\(in oklch,/g, 'mix(');
    expect(withoutMixes).not.toMatch(LITERAL);
  });

  it('declares the score tokens on a bare page too', () => {
    expect(css).toMatch(/\.score-view,\s*\.score-pages,\s*\.score-page\s*{\s*--score-paper:/);
  });

  it('sizes the paper by its own height on screen and by the page size in print', () => {
    expect(css).toMatch(/\.score-page\s*{[^}]*height: var\(--score-paper-height\);/);
    expect(css).toMatch(
      /@media print\s*{[\s\S]*\.score-page\s*{\s*height: var\(--score-page-height\);/,
    );
  });

  it('hides overlays and breaks pages in print', () => {
    expect(css).toMatch(/@media print\s*{[\s\S]*\.score-overlays\s*{\s*display: none;/);
    expect(css).toMatch(/\.score-page \+ \.score-page\s*{\s*break-before: page;/);
  });

  it("names one page per paper at exactly layout's page size, with no margin", () => {
    for (const [paper, { width, height }] of Object.entries(PAGE_SIZES)) {
      const rule = new RegExp(`@page reprise-${paper}\\s*{([^}]*)}`).exec(css)?.[1] ?? '';
      expect(rule).toContain(`size: ${String(width)}px ${String(height)}px;`);
      expect(rule).toContain('margin: 0;');
      expect(css).toMatch(
        new RegExp(`\\.score-print\\[data-paper='${paper}'\\]\\s*{\\s*page: reprise-${paper};`),
      );
    }
  });

  it('prints in the light paper whatever the theme', () => {
    const rule = /\.score-print\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    for (const token of ['paper', 'ink', 'ink-muted', 'paper-accent']) {
      expect(rule).toContain(`--${token}: var(--${token}-light);`);
    }
    expect(rule).toContain('display: none;');
  });

  it('hides the app and lets html and body grow in print', () => {
    const print = css.slice(css.indexOf('@media print'));
    expect(print).toMatch(
      /body:has\(> \.score-print\) > :not\(\.score-print\)\s*{\s*display: none;/,
    );
    expect(print).toMatch(
      /html:has\(> body > \.score-print\),\s*body:has\(> \.score-print\)\s*{\s*height: auto;\s*overflow: visible;/,
    );
    expect(print).toMatch(/\.score-print \.score-page\s*{\s*overflow: clip;/);
  });

  it('styles the selection pill from the pill tokens and hides it in print', () => {
    const pill = /\.score-pill\s*{([^}]*)}/.exec(css)?.[1] ?? '';
    expect(pill).toContain('box-shadow: var(--pill-shadow);');
    expect(pill).toContain('border: 1px solid var(--pill-border);');
    expect(css).toMatch(/@media print\s*{[\s\S]*\.score-pill\s*{\s*display: none;/);
  });

  it('defines the pill tokens in the light and the dark theme', () => {
    // Read from disk: the build's CSS pipeline turns a raw import of this file into nothing.
    const theme = readFileSync(join(import.meta.dirname, '../../index.css'), 'utf8');
    const light = /:root\[data-theme='light'\]\s*{([\s\S]*?)\n}/.exec(theme)?.[1] ?? '';
    const dark = /:root,\s*:root\[data-theme='dark'\]\s*{([\s\S]*?)\n}/.exec(theme)?.[1] ?? '';
    for (const block of [light, dark]) {
      expect(block).toContain('--pill-shadow:');
      expect(block).toContain('--pill-border:');
    }
    expect(light).toContain('--pill-border: transparent;');
    expect(dark).toContain('--pill-shadow: none;');
  });
});
