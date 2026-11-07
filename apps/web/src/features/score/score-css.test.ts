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
});
