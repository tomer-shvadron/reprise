import * as alphaTab from '@coderline/alphatab';
import { describe, expect, it } from 'vitest';

import { slideFeatures } from './describe.ts';

const { SlideInType, SlideOutType } = alphaTab.model;

describe('slideFeatures', () => {
  it.each([
    ['a slide in', SlideInType.IntoFromBelow, SlideOutType.None, ['slides']],
    ['a slide out', SlideInType.None, SlideOutType.Shift, ['slides']],
    ['a pick slide', SlideInType.None, SlideOutType.PickSlideDown, ['pick-scrape']],
    // Flags 64 + 16: the pick slide hides only the slide out, never the slide in.
    [
      'a pick slide and a slide in',
      SlideInType.IntoFromBelow,
      SlideOutType.PickSlideUp,
      ['pick-scrape', 'slides'],
    ],
    ['neither', SlideInType.None, SlideOutType.None, []],
  ])('counts %s', (_name, slideInType, slideOutType, expected) => {
    expect(slideFeatures({ slideInType, slideOutType })).toEqual(expected);
  });
});
