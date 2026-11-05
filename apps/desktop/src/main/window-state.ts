import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /** Absent means centred on the primary display. */
  position?: { x: number; y: number };
  width: number;
  height: number;
  maximized: boolean;
}

export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 800, maximized: false };
export const MIN_WINDOW_SIZE = { width: 800, height: 600 } as const;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseWindowState(value: unknown): WindowState | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, width, height, maximized } = value;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || typeof maximized !== 'boolean') {
    return undefined;
  }
  const state: WindowState = { width: Math.round(width), height: Math.round(height), maximized };
  if (isFiniteNumber(x) && isFiniteNumber(y))
    state.position = { x: Math.round(x), y: Math.round(y) };
  return state;
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Keeps a restored window reachable: a display can be unplugged between launches, so a window
 * that would land off every display is recentred, and one larger than the biggest display shrinks.
 */
export function fitToDisplays(state: WindowState, workAreas: readonly Rect[]): WindowState {
  if (workAreas.length === 0) return state;
  const maxWidth = Math.max(...workAreas.map((area) => area.width));
  const maxHeight = Math.max(...workAreas.map((area) => area.height));
  const fitted: WindowState = {
    width: Math.max(MIN_WINDOW_SIZE.width, Math.min(state.width, maxWidth)),
    height: Math.max(MIN_WINDOW_SIZE.height, Math.min(state.height, maxHeight)),
    maximized: state.maximized,
  };
  const { position } = state;
  if (position && workAreas.some((area) => overlaps({ ...position, ...fitted }, area))) {
    fitted.position = position;
  }
  return fitted;
}

// Synchronous so the final save on window close completes before the app quits.

export function readWindowState(file: string): WindowState | undefined {
  try {
    return parseWindowState(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return undefined;
  }
}

export function writeWindowState(file: string, state: WindowState): void {
  const { position, ...size } = state;
  mkdirSync(dirname(file), { recursive: true });
  // Write then rename, so a crash mid-write never leaves a truncated file to restore from.
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...position, ...size }, null, 2));
  renameSync(temp, file);
}
