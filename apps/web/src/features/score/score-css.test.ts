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

  it('hides overlays and breaks pages in print', () => {
    expect(css).toMatch(/@media print\s*{[\s\S]*\.score-overlays\s*{\s*display: none;/);
    expect(css).toMatch(/\.score-page \+ \.score-page\s*{\s*break-before: page;/);
  });
});
