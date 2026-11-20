import { write } from '@reprise/formats';
import { anchorBox, hitTest, markAt, type Anchor, type LayoutResult } from '@reprise/layout';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { nearestColumn, type ScoreHit } from '@/features/score';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

import { adoptMenuTarget, scoreKeyboardRequest, scoreMenuRequest } from './menu-target';

/** Two tracks over six bars; a section on bars 2 and 5, a chord name on the first beat of bar 2. */
function song() {
  const builder = score();
  for (const instrument of ['guitar', 'bass'] as const) {
    builder.track(instrument);
    for (let bar = 0; bar < 6; bar++) {
      builder.bar();
      if (instrument === 'guitar' && bar === 1) builder.section('Verse');
      if (instrument === 'guitar' && bar === 4) builder.section('Chorus');
      builder.beat('4', [note(1, bar)], bar === 1 ? { chord: { name: 'Am' } } : {});
      builder.beat('4', [note(2, bar)]);
    }
  }
  return builder.build({ ids: 'sequential' });
}

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  await services.document
    .getState()
    .openBytes('menu.reprise', (await write(song(), 'reprise')).bytes);
  const loaded = services.document.getState().score;
  const layout = services.layout.getState().result;
  if (!loaded || !layout) throw new Error('not open');
  return { services, score: loaded, layout };
}

const centre = (layout: LayoutResult, anchor: Anchor) => {
  const box = anchorBox(layout, anchor);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};

/** What the score view finds at a layout point. */
function hitAtPoint(layout: LayoutResult, x: number, y: number): ScoreHit {
  const point = { x, y };
  return {
    point,
    anchor: hitTest(layout, x, y),
    column: nearestColumn(layout, layout.systems, point),
    mark: markAt(layout, x, y),
  };
}

function hitOn(layout: LayoutResult, anchor: Anchor): ScoreHit {
  const { x, y } = centre(layout, anchor);
  return hitAtPoint(layout, x, y);
}

describe('scoreMenuRequest', () => {
  it('opens the chord name menu on a chord name, and the section menu on a marker', async () => {
    const { services, layout, score: loaded } = await setup();
    const chord = layout.primitives.find((p) => p.kind === 'text' && p.lane === 'chord');
    const section = layout.primitives.find(
      (p) => p.kind === 'text' && p.lane === 'section' && p.node !== undefined,
    );
    if (!chord || !section) throw new Error('no marks');
    const at = (p: typeof chord) =>
      hitAtPoint(layout, p.bbox.x + p.bbox.width / 2, p.bbox.y + p.bbox.height / 2);

    const chordMenu = scoreMenuRequest(at(chord), services, 'play');
    expect(chordMenu?.request).toMatchObject({
      surface: 'score.chord',
      target: { kind: 'chord', masterBar: loaded.masterBars[1]?.id },
      label: 'Chord name, bar 2',
    });
    expect(chordMenu?.adopt?.bars).toEqual({
      startBar: loaded.masterBars[1]?.id,
      endBar: loaded.masterBars[1]?.id,
    });

    const sectionMenu = scoreMenuRequest(at(section), services, 'play');
    expect(sectionMenu?.request).toMatchObject({
      surface: 'score.section',
      target: { kind: 'section', masterBar: section.node },
    });
    expect(sectionMenu?.request.label).toMatch(/^Section /u);
  });

  it('opens the paper outside every system, and with no score', async () => {
    const { services, layout } = await setup();
    const outside = scoreMenuRequest(hitAtPoint(layout, -50, -50), services, 'play');
    expect(outside).toEqual({
      request: { surface: 'score.paper', target: { kind: 'paper' }, label: 'Score' },
    });
    services.document.setState({ score: undefined });
    const none = scoreMenuRequest(hitAtPoint(layout, 5, 5), services, 'play');
    expect(none?.request.surface).toBe('score.paper');
  });

  it('opens the note, beat and bar under the point, each adopting its bar and track', async () => {
    const { services, layout, score: loaded } = await setup();
    const find = (kind: Anchor['kind']) => {
      const found = layout.anchors.find((a) => a.kind === kind && a.track !== undefined);
      if (!found) throw new Error(`no ${kind}`);
      return found;
    };
    const noteAnchor = find('note');
    const open = scoreMenuRequest(hitOn(layout, noteAnchor), services, 'play');
    expect(open?.request.surface).toBe('score.note');
    expect(open?.request.target).toMatchObject({ kind: 'note', note: noteAnchor.id });
    expect(open?.adopt?.track).toBe(noteAnchor.track);

    const beat = layout.anchors.find((a) => a.kind === 'beat');
    if (!beat) throw new Error('no beat');
    const asBeat = scoreMenuRequest(
      { point: { x: 0, y: 0 }, anchor: beat, column: undefined, mark: undefined },
      services,
      'play',
    );
    expect(asBeat?.request).toMatchObject({ surface: 'score.beat', target: { kind: 'beat' } });

    const bar = layout.anchors.find((a) => a.kind === 'bar' && a.track !== undefined);
    if (!bar) throw new Error('no bar');
    const asBar = scoreMenuRequest(
      { point: { x: 0, y: 0 }, anchor: bar, column: undefined, mark: undefined },
      services,
      'play',
    );
    expect(asBar?.request.surface).toBe('score.bar');
    expect(asBar?.request.target).toMatchObject({ kind: 'bar', track: bar.track });
    expect(loaded.masterBars.map((b) => b.id)).toContain(bar.masterBar);
  });

  it('opens the range menu on a click inside the selected bars, and adopts nothing', async () => {
    const { services, layout, score: loaded } = await setup();
    const first = loaded.masterBars[0];
    const second = loaded.masterBars[1];
    if (!first || !second) throw new Error('short song');
    services.selection.getState().selectBars({ startBar: first.id, endBar: second.id });
    const inside = layout.anchors.find(
      (a) => a.kind === 'note' && a.masterBar === second.id && a.track !== undefined,
    );
    if (!inside) throw new Error('no note');
    const open = scoreMenuRequest(hitOn(layout, inside), services, 'play');
    expect(open).toEqual({
      request: {
        surface: 'score.range',
        target: { kind: 'range', bar: second.id },
        label: 'Bars 1 to 2',
      },
    });
    const outside = layout.anchors.find(
      (a) => a.kind === 'note' && a.masterBar !== first.id && a.masterBar !== second.id,
    );
    if (!outside) throw new Error('no note');
    expect(scoreMenuRequest(hitOn(layout, outside), services, 'play')?.request.surface).toBe(
      'score.note',
    );
  });

  it('falls back to the column for a staff or system hit, and adopts the second track', async () => {
    const { services, layout, score: loaded } = await setup();
    const bass = loaded.tracks[1];
    const staff = layout.anchors.find((a) => a.kind === 'staff' && a.track === bass?.id);
    const system = layout.anchors.find((a) => a.kind === 'system');
    const column = layout.anchors.find((a) => a.kind === 'bar' && a.track === undefined);
    if (!staff || !system || !column) throw new Error('no anchors');
    const onStaff = scoreMenuRequest(
      { point: { x: 0, y: 0 }, anchor: staff, column, mark: undefined },
      services,
      'play',
    );
    expect(onStaff?.request).toMatchObject({
      surface: 'score.bar',
      target: { kind: 'bar', masterBar: staff.masterBar ?? column.id, track: bass?.id },
    });
    expect(onStaff?.adopt?.track).toBe(bass?.id);
    const onSystem = scoreMenuRequest(
      { point: { x: 0, y: 0 }, anchor: system, column, mark: undefined },
      services,
      'play',
    );
    expect(onSystem?.request.target).toMatchObject({ kind: 'bar', masterBar: column.id });
    // Nothing names a bar at all: the paper.
    const none = scoreMenuRequest(
      { point: { x: 0, y: 0 }, anchor: system, column: undefined, mark: undefined },
      services,
      'play',
    );
    expect(none?.request.surface).toBe(
      system.masterBar === undefined ? 'score.paper' : 'score.bar',
    );
  });

  it('adopts the bass track on a bass note, in multitrack view', async () => {
    const { services, layout, score: loaded } = await setup();
    const bass = loaded.tracks[1];
    const anchor = layout.anchors.find((a) => a.kind === 'note' && a.track === bass?.id);
    if (!anchor) throw new Error('no bass note');
    const open = scoreMenuRequest(hitOn(layout, anchor), services, 'play');
    expect(open?.request.target).toMatchObject({ kind: 'note', track: bass?.id });
    expect(open?.adopt?.track).toBe(bass?.id);
  });

  it('finds a chord name in continuous view, where the segments are shifted', async () => {
    const { services, score: loaded } = await setup();
    const { layout: lay } = await import('@reprise/layout');
    const continuous = lay(loaded, {
      mode: 'continuous',
      width: 300,
      zoom: 1,
      tracks: 'all',
      notation: {},
    });
    // A segment's primitives are in its own frame; its `offsetX` puts them on the page.
    const system = continuous.systems.find((candidate) => (candidate.offsetX ?? 0) > 0);
    if (!system) throw new Error('no shifted segment');
    const chord = continuous.primitives
      .slice(system.primitives.start, system.primitives.end)
      .find((p) => p.kind === 'text' && p.lane === 'chord');
    if (!chord) throw new Error('no chord in the shifted segment');
    const open = scoreMenuRequest(
      hitAtPoint(
        continuous,
        chord.bbox.x + chord.bbox.width / 2 + (system.offsetX ?? 0),
        chord.bbox.y + chord.bbox.height / 2,
      ),
      services,
      'play',
    );
    expect(open?.request.surface).toBe('score.chord');
  });

  it('keeps the browser’s menu in edit mode for now', async () => {
    const { services, layout } = await setup();
    const anchor = layout.anchors.find((a) => a.kind === 'note');
    if (!anchor) throw new Error('no note');
    expect(scoreMenuRequest(hitOn(layout, anchor), services, 'edit')).toBeUndefined();
  });

  it('adopts the bar and track without seeking', async () => {
    const { services, score: loaded } = await setup();
    const c = loaded.masterBars[2];
    const bass = loaded.tracks[1];
    if (!c || !bass) throw new Error('short song');
    adoptMenuTarget(services, { bars: { startBar: c.id, endBar: c.id }, track: bass.id });
    expect(services.selection.getState().bars).toEqual({ startBar: c.id, endBar: c.id });
    expect(services.selection.getState().currentTrack).toBe(bass.id);
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
  });

  it('selects the bar with an active loop on, and leaves the loop and playhead alone', async () => {
    const { services, score: loaded } = await setup();
    const [a, b, c] = loaded.masterBars;
    const bass = loaded.tracks[1];
    if (!a || !b || !c || !bass) throw new Error('short song');
    services.audio.setLoop({ startBar: a.id, endBar: b.id });
    services.selection.getState().selectBars({ startBar: a.id, endBar: b.id });
    adoptMenuTarget(services, { bars: { startBar: c.id, endBar: c.id }, track: bass.id });
    expect(services.selection.getState().bars).toEqual({ startBar: c.id, endBar: c.id });
    expect(services.selection.getState().currentTrack).toBe(bass.id);
    expect(services.playback.getState().settings.loop).toEqual({ startBar: a.id, endBar: b.id });
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    // A later selection by any other way follows the loop again, as a drag does.
    services.selection.getState().selectBars({ startBar: b.id, endBar: c.id });
    expect(services.playback.getState().settings.loop).toEqual({ startBar: b.id, endBar: c.id });
  });
});

describe('scoreKeyboardRequest', () => {
  const rect = (r: { x: number; y: number; width: number; height: number }) =>
    new DOMRect(r.x + 1000, r.y, r.width, r.height);

  it('opens the selected bars’ menu at the first selected column', async () => {
    const { services, layout, score: loaded } = await setup();
    const [a, b] = loaded.masterBars;
    if (!a || !b) throw new Error('short song');
    services.selection.getState().selectBars({ startBar: a.id, endBar: b.id });
    const request = scoreKeyboardRequest(services, layout, rect, 'play');
    expect(request).toMatchObject({ surface: 'score.range', label: 'Bars 1 to 2' });
    expect(request?.anchor?.left).toBeGreaterThanOrEqual(1000);
  });

  it('opens the bar of the last click without a selection, else the first bar', async () => {
    const { services, layout, score: loaded } = await setup();
    const [first, , third] = loaded.masterBars;
    if (!first || !third) throw new Error('short song');
    expect(scoreKeyboardRequest(services, layout, rect, 'play')?.target).toMatchObject({
      kind: 'bar',
      masterBar: first.id,
    });
    services.selection.getState().selectBars(undefined, third.id);
    expect(scoreKeyboardRequest(services, layout, rect, 'play')).toMatchObject({
      surface: 'score.bar',
      target: { masterBar: third.id },
      label: 'Bar 3',
    });
    expect(scoreKeyboardRequest(services, layout, rect, 'edit')).toBeUndefined();
  });
});
