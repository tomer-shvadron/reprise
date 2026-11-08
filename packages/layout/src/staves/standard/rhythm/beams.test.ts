import { array, assert, boolean, constantFrom, double, integer, oneof, property } from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { LayoutSink } from '../../../primitives';
import { SHORTENING, beamLine, beamY, drawBeams, type BeamStem } from './beams';
import { stemLength, stemThickness } from './stems';

const space = 10;
const stem = (x: number, head: number, beams = 1): BeamStem => ({ x, head, beams });

describe('beamLine', () => {
  it('keeps the slope of in-order stems at least a space apart', () => {
    const line = beamLine([stem(0, 50), stem(20, 40), stem(40, 30)], 'up', { space, exact: true });
    expect(line.end).toBeLessThan(line.start);
  });

  it('is horizontal when the stems are out of order', () => {
    const line = beamLine([stem(20, 50), stem(10, 40), stem(30, 30)], 'up', { space, exact: true });
    expect(line.start).toBe(line.end);
  });

  it('is horizontal when the outer stems are under a space apart', () => {
    const line = beamLine([stem(10, 50), stem(10.2, 15)], 'up', { space, exact: true });
    expect(line.start).toBe(line.end);
  });

  it('ignores x entirely when not exact', () => {
    const line = beamLine([stem(3.7, 50), stem(3.7, 40), stem(3.7, 30)], 'up', {
      space,
      exact: false,
    });
    expect(line.end).toBeLessThan(line.start);
  });

  it('never reaches past the measured room, and every stem keeps its length', () => {
    const stems = array(
      oneof(double({ min: 0, max: 200, noNaN: true }), integer({ min: 0, max: 20 })),
      { minLength: 2, maxLength: 8 },
    );
    assert(
      property(
        stems,
        boolean(),
        array(integer({ min: -40, max: 80 }), { minLength: 8, maxLength: 8 }),
        array(integer({ min: 1, max: 4 }), { minLength: 8, maxLength: 8 }),
        constantFrom('up', 'down'),
        constantFrom(undefined, 20),
        integer({ min: 0, max: 5 }),
        (xs, sorted, heads, levels, direction, middle, extend) => {
          const list = sorted ? [...xs].sort((a, b) => a - b) : xs;
          const group = list.map((x, i) => stem(x, heads[i] ?? 0, levels[i] ?? 1));
          const base = { space, ...(middle !== undefined && { middle }), extend };
          const bound = beamLine(group, direction, { ...base, exact: false });
          const line = beamLine(group, direction, { ...base, exact: true });
          const up = direction === 'up';
          const furthest = (y: number[]) => (up ? Math.min(...y) : Math.max(...y));
          const bounded = furthest([bound.start, bound.end]);
          const ys = [line.start, line.end, ...group.map((s) => beamY(group, line, s.x))];
          expect(up ? furthest(ys) - bounded : bounded - furthest(ys)).toBeGreaterThanOrEqual(
            -1e-6,
          );
          const minimum =
            (stemLength(Math.max(...group.map((s) => s.beams))) - SHORTENING) * space - 1e-6;
          for (const s of group) {
            const length = up ? s.head - beamY(group, line, s.x) : beamY(group, line, s.x) - s.head;
            expect(length).toBeGreaterThanOrEqual(minimum);
          }
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('drawBeams', () => {
  it('runs one beam from the leftmost to the rightmost stem of an out-of-order group', () => {
    const stems = [stem(20, 50), stem(10, 40), stem(30, 30)];
    const beam = beamLine(stems, 'up', { space, exact: true });
    const sink: LayoutSink = { primitives: [], anchors: [] };
    drawBeams(sink, stems, 'up', beam, space, { node: 'n' });
    expect(sink.primitives).toHaveLength(1);
    const [primitive] = sink.primitives;
    const numbers =
      primitive && 'd' in primitive ? (primitive.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number) : [];
    const half = stemThickness(space) / 2;
    const [x1, y1, x2, y2] = numbers;
    expect(x1).toBeCloseTo(10 - half, 1);
    expect(x2).toBeCloseTo(30 + half, 1);
    expect(y1).toBeCloseTo(beam.start, 1);
    expect(y2).toBeCloseTo(beam.start, 1);
  });
});
