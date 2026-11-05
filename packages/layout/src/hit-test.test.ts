import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, hitTest, layout, type Anchor, type LayoutOptions } from './index';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

const built = score()
  .track('guitar')
  .bar()
  .beat('4', [note(1, 0)])
  .beat('4', [note(1, 2)])
  .rest('2')
  .bar()
  .beat('1', [note(2, 3)])
  .build({ ids: 'sequential' });
const result = layout(built, paged);

function centre(anchor: Anchor | undefined): [number, number] {
  if (!anchor) throw new Error('no anchor');
  return [anchor.bbox.x + anchor.bbox.width / 2, anchor.bbox.y + anchor.bbox.height / 2];
}

describe('hitTest', () => {
  it('finds the beat under a point', () => {
    for (const beat of result.anchors.filter((anchor) => anchor.kind === 'beat')) {
      expect(hitTest(result, ...centre(beat))?.id).toBe(beat.id);
    }
  });

  it('falls back from the beat to the track bar, the staff and the system', () => {
    const bar = result.anchors.find(
      (anchor) => anchor.kind === 'bar' && anchor.track !== undefined,
    );
    const firstBeat = result.anchors.find((anchor) => anchor.kind === 'beat');
    if (!bar || !firstBeat) throw new Error('missing anchors');
    expect(hitTest(result, bar.bbox.x + 1, firstBeat.bbox.y + 1)).toMatchObject({
      kind: 'bar',
      id: bar.id,
      track: bar.track,
    });
    const staff = result.anchors.find((anchor) => anchor.kind === 'staff');
    if (!staff) throw new Error('no staff anchor');
    expect(hitTest(result, staff.bbox.x + 2, staff.bbox.y + 2)?.kind).toBe('staff');
    const system = result.systems[0];
    if (!system) throw new Error('no system');
    expect(hitTest(result, system.bbox.x + 1, system.bbox.y + 1)).toMatchObject({
      kind: 'system',
      id: system.id,
    });
  });

  it('finds nothing outside every system', () => {
    expect(hitTest(result, 1, 1)).toBeUndefined();
    expect(hitTest(result, -100, 500)).toBeUndefined();
  });
});
