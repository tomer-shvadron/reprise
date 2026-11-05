import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  fitToDisplays,
  MIN_WINDOW_SIZE,
  parseWindowState,
  readWindowState,
  writeWindowState,
  type WindowState,
} from './window-state';

const tempFile = () => join(mkdtempSync(join(tmpdir(), 'reprise-window-')), 'window-state.json');
const display = { x: 0, y: 0, width: 1920, height: 1080 };

describe('window state', () => {
  it('round-trips through the file', () => {
    const file = tempFile();
    const state: WindowState = {
      position: { x: 40, y: 60 },
      width: 1200,
      height: 700,
      maximized: true,
    };

    writeWindowState(file, state);

    expect(readWindowState(file)).toEqual(state);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      x: 40,
      y: 60,
      width: 1200,
      height: 700,
      maximized: true,
    });
  });

  it('reads a missing or corrupt file as no state', () => {
    const file = tempFile();
    expect(readWindowState(file)).toBeUndefined();

    writeFileSync(file, '{"width": 12');
    expect(readWindowState(file)).toBeUndefined();
  });

  it.each([
    [null],
    ['text'],
    [{ width: 800, height: 600 }],
    [{ width: '800', height: 600, maximized: false }],
    [{ width: Number.NaN, height: 600, maximized: false }],
  ])('rejects the malformed state %j', (value) => {
    expect(parseWindowState(value)).toBeUndefined();
  });

  it('drops a position that is incomplete', () => {
    expect(parseWindowState({ x: 10, width: 900, height: 700, maximized: false })).toEqual({
      width: 900,
      height: 700,
      maximized: false,
    });
  });

  it('keeps a window that is on a display', () => {
    const state: WindowState = {
      position: { x: 100, y: 100 },
      width: 1200,
      height: 800,
      maximized: false,
    };
    expect(fitToDisplays(state, [display])).toEqual(state);
  });

  it('recentres a window whose display is gone', () => {
    const state: WindowState = {
      position: { x: 2500, y: 100 },
      width: 1200,
      height: 800,
      maximized: false,
    };
    expect(fitToDisplays(state, [display])).toEqual({ width: 1200, height: 800, maximized: false });
  });

  it('shrinks a window larger than every display and grows one below the minimum', () => {
    expect(fitToDisplays({ width: 4000, height: 3000, maximized: false }, [display])).toEqual({
      width: 1920,
      height: 1080,
      maximized: false,
    });
    expect(fitToDisplays({ width: 200, height: 100, maximized: false }, [display])).toEqual({
      ...MIN_WINDOW_SIZE,
      maximized: false,
    });
  });
});
