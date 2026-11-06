import { describe, expect, it } from 'vitest';

import { FOLLOW_MARGIN, GLIDE_TAU, followBand, glide, pageTurn } from './follow';

const window = { x: 0, y: 1000, width: 800, height: 900 };
const system = (y: number, height = 250) => ({ x: 0, y, width: 700, height });

describe('page turns', () => {
  it('turn when the next system is not fully in view, putting the current one at the top', () => {
    // Systems at 1000, 1300 and 1600: the third ends at 1850, inside the window's 1900.
    expect(pageTurn(window, system(1300), system(1600))).toBeUndefined();
    expect(pageTurn(window, system(1600), system(1900))).toEqual({
      y: 1600 - FOLLOW_MARGIN,
      instant: false,
    });
  });

  it('jump instantly to a current system off screen, and leave the last system alone', () => {
    expect(pageTurn(window, system(200), system(500))).toEqual({
      y: 200 - FOLLOW_MARGIN,
      instant: true,
    });
    expect(pageTurn(window, system(1600), undefined)).toBeUndefined();
  });

  it('do not turn again once a system the window cannot hold with its next is at the top', () => {
    const top = { ...window, y: 1600 - FOLLOW_MARGIN };
    expect(pageTurn(top, system(1600, 700), system(2400, 700))).toBeUndefined();
  });

  it('keep the followed track’s staves in view when a system is taller than the window', () => {
    const tall = system(0, 2000);
    const staves = { x: 0, y: 600, width: 700, height: 200 };
    expect(followBand(tall, staves, 900)).toBe(staves);
    expect(followBand(system(0), staves, 900)).toEqual(system(0));
    expect(followBand(tall, undefined, 900)).toBe(tall);
  });
});

describe('the continuous glide', () => {
  it('settles at a lag of speed times τ behind the third-of-the-window target', () => {
    const speed = 0.4; // px per ms
    let x = 0;
    let line = 400;
    for (let step = 0; step < 2000; step++) {
      line += speed * 16;
      x = glide(x, 900, line, 16, false);
    }
    const lag = line - 900 / 3 - x;
    expect(lag).toBeCloseTo(speed * GLIDE_TAU, -1);
  });

  it('snaps to a line outside the window, locks with reduced motion and clamps dt', () => {
    expect(glide(0, 900, 2000, 16, false)).toBe(2000 - 300);
    expect(glide(0, 900, 600, 16, true)).toBe(300);
    expect(glide(0, 900, 600, 10_000, false)).toBe(glide(0, 900, 600, 100, false));
    expect(glide(0, 900, 600, -5, false)).toBe(0);
  });
});
