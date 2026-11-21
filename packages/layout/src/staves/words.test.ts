import { score, midi, note } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions, type LayoutResult } from '../index';
import { expectValid } from '../test/check-result';
import { standardModule } from './standard';
import type { StaffBar } from './staff-module';
import { textWidth } from '../metrics';
import type { Beat } from '@reprise/model';
import type { LayoutSink } from '../primitives';
import { chordDiagramSize } from './chord-diagram';
import { WORDS, drawWords, wordLanes, wordRows, wordsExtent } from './words';

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function laid(built: ReturnType<ReturnType<typeof score>['build']>, notation: string) {
  const track = built.tracks[0];
  const result = layout(built, {
    ...paged,
    notation: track ? { [track.id]: notation as 'standard' | 'tab' | 'both' } : {},
  });
  expectValid(result);
  return result;
}

function texts(result: LayoutResult) {
  return result.primitives.flatMap((p) => (p.kind === 'text' ? [p] : []));
}

describe('word lanes', () => {
  it('ask only for the lines a bar uses', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], { lyrics: ['la', '', 'sol'] })
      .beat('4', [note(1, 0)], { text: 'x' })
      .build({ ids: 'sequential' });
    const beats = built.tracks.flatMap((t) =>
      t.bars.flatMap((b) => b.voices.flatMap((v) => v.beats)),
    );
    const rows = wordRows(beats, 10, true);
    expect(rows.chord).toBe(0);
    expect(rows.text).toBeGreaterThan(0);
    expect(rows.lyrics).toBeCloseTo(3 * 2 * 10, 5);
    expect(wordLanes(rows)).toEqual({ text: rows.text, lyrics: rows.lyrics });
    expect(wordLanes(wordRows([], 10, true))).toEqual({});
  });

  it('are requested by a standard staff shown alone, not under a tab', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], { chord: { name: 'Am' }, lyrics: ['la'] })
      .build({ ids: 'sequential' });
    const track = built.tracks[0];
    const bar = track?.bars[0];
    const masterBar = built.masterBars[0];
    if (!track || !bar || !masterBar) throw new Error('no bar');
    const input = (staves: StaffBar['staves']): StaffBar => ({
      score: built,
      track,
      trackIndex: 0,
      staves,
      bar,
      masterBar,
      barIndex: 0,
      clef: 'treble',
      keySignature: masterBar.keySignature,
      chordDiagrams: true,
      space: 7,
    });
    const alone = standardModule().lanes(input(['standard']));
    expect(alone.chord).toBeGreaterThan(0);
    expect(alone.lyrics).toBeGreaterThan(0);
    expect(standardModule().lanes(input(['standard', 'tab']))).toEqual({});
  });
});

describe('words on a standard staff', () => {
  const built = () =>
    score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], { chord: { name: 'Am7' }, lyrics: ['Twin-', 'Ein'] })
      .beat('4', [note(1, 2)], { text: 'riff', lyrics: ['kle'] })
      .beat('4', [note(2, 1)], { lyrics: ['twin-'] })
      .beat('4', [note(3, 0)], { lyrics: ['kle'] })
      .bar()
      .beat('4', [note(1, 0)], { chord: { name: 'D' }, lyrics: ['lit-'] })
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .build({ ids: 'sequential' });

  it('draws a chord name above the staff and lyric lines below it, each on its beat', () => {
    const score = built();
    const result = laid(score, 'standard');
    const top = result.systems[0]?.staves[0]?.top ?? 0;
    const bottom = result.systems[0]?.staves[0]?.bottom ?? 0;
    const beatIds = score.tracks.flatMap((t) =>
      t.bars.flatMap((b) => b.voices.flatMap((v) => v.beats.map((beat) => beat.id))),
    );
    const drawn = texts(result);
    const chord = drawn.find((p) => p.text === 'Am7');
    expect(chord?.node).toBe(beatIds[0]);
    expect(chord?.y ?? Infinity).toBeLessThan(top);
    const first = drawn.find((p) => p.text === 'Twin' && p.lane === 'lyric:0');
    const second = drawn.find((p) => p.text === 'Ein');
    expect(first?.node).toBe(beatIds[0]);
    expect(first?.anchor).toBe('middle');
    expect(first?.y ?? 0).toBeGreaterThan(bottom);
    expect(second?.y ?? 0).toBeGreaterThan(first?.y ?? Infinity);
    expect(first?.x).toBe(second?.x);
    // Every syllable of one lyric line sits on one baseline.
    const line = (text: string) => drawn.filter((p) => p.text === text).map((p) => p.y);
    expect(new Set([...line('Twin'), ...line('kle'), ...line('twin'), ...line('lit')]).size).toBe(
      1,
    );
    expect(drawn.find((p) => p.text === 'riff')?.node).toBe(beatIds[1]);
  });

  it('starts a chord name at the left edge of the heads, clear of an accidental', () => {
    const sharp = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 2)], { chord: { name: 'F#' } })
      .build({ ids: 'sequential' });
    const result = laid(sharp, 'standard');
    const head = result.primitives.find(
      (p) => p.kind === 'glyph' && p.glyph.startsWith('notehead'),
    );
    const accidental = result.primitives.find(
      (p) => p.kind === 'glyph' && p.glyph.startsWith('accidental'),
    );
    const name = texts(result).find((p) => p.text === 'F#');
    if (head?.kind !== 'glyph' || accidental?.kind !== 'glyph' || !name) throw new Error('missing');
    expect(accidental.x).toBeLessThan(head.x);
    expect(name.x).toBeCloseTo(head.x, 5);
    expect(name.x).toBeGreaterThan(accidental.x + accidental.bbox.width - 1e-6);
  });

  it('cuts the last bar of a system with an ellipsis', () => {
    const long = 'Allegro con brio ma non troppo and then some more words';
    const narrow = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)], { chord: { name: long } })
      .build({ ids: 'sequential' });
    const built = narrow;
    const track = built.tracks[0];
    const result = layout(built, {
      ...paged,
      width: 260,
      notation: track ? { [track.id]: 'standard' } : {},
    });
    const cut = texts(result).find((p) => p.text.endsWith('…'));
    expect(cut).toBeDefined();
    const bar = result.anchors.find((a) => a.kind === 'bar');
    expect((cut?.bbox.x ?? 0) + (cut?.bbox.width ?? Infinity)).toBeLessThanOrEqual(
      (bar?.bbox.x ?? 0) + (bar?.bbox.width ?? 0) + 1e-6,
    );
  });

  it('keeps the words on the tab in both mode', () => {
    const result = laid(built(), 'both');
    const staves = result.systems[0]?.staves ?? [];
    const tab = staves.find((s) => s.type === 'tab');
    const standard = staves.find((s) => s.type === 'standard');
    const chord = texts(result).find((p) => p.text === 'Am7');
    // Standard on top, the tab under it, and the words around the tab only.
    expect(chord?.y).toBeGreaterThan(standard?.bottom ?? Infinity);
    expect(chord?.y).toBeLessThan(tab?.top ?? 0);
    expect(texts(result).filter((p) => p.text === 'Am7')).toHaveLength(1);
  });

  it('carries the beat as the node of every word, as the tab does', () => {
    const result = laid(built(), 'standard');
    const nodes = new Set(result.anchors.filter((a) => a.kind === 'beat').map((a) => a.id));
    const spoken = ['Am7', 'D', 'riff', 'Twin', 'Ein', 'kle', 'twin', 'lit', '-'];
    const drawn = texts(result).filter((p) => spoken.includes(p.text));
    expect(drawn).toHaveLength(12);
    for (const p of drawn) expect(nodes.has(p.node ?? '')).toBe(true);
  });
});

describe('words on a percussion staff', () => {
  it('draws a chord name above and two lyric lines below', () => {
    const built = score()
      .track('drums')
      .bar()
      .beat('4', [midi(36)], { chord: { name: 'Groove' }, lyrics: ['one', 'uno'] })
      .beat('4', [midi(38)])
      .beat('4', [midi(36)])
      .beat('4', [midi(38)])
      .build({ ids: 'sequential' });
    const result = layout(built, paged);
    expectValid(result);
    const beat = built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.id;
    const staff = result.systems[0]?.staves[0];
    const drawn = texts(result);
    const chord = drawn.find((p) => p.text === 'Groove');
    expect(chord?.node).toBe(beat);
    expect(chord?.y ?? Infinity).toBeLessThan(staff?.top ?? 0);
    const one = drawn.find((p) => p.text === 'one');
    const uno = drawn.find((p) => p.text === 'uno');
    expect(one?.node).toBe(beat);
    expect(uno?.node).toBe(beat);
    expect(uno?.y ?? 0).toBeGreaterThan(one?.y ?? Infinity);
    expect(one?.y ?? 0).toBeGreaterThan(staff?.bottom ?? Infinity);
  });
});

describe('word lanes on the primitives and the staff placements', () => {
  const built = (words: boolean) => {
    const track = score().track('guitar');
    const bar = track.bar();
    bar.beat(
      '4',
      [note(1, 0)],
      words ? { chord: { name: 'C' }, text: 'Coda', lyrics: ['', 'two'] } : {},
    );
    bar.beat('4', [note(1, 0)]);
    return track.build({ ids: 'sequential' });
  };

  it('tag a chord name, beat text and each lyric line with its row', () => {
    const lanes = texts(laid(built(true), 'tab')).flatMap((p) => (p.lane === undefined ? [] : [p]));
    expect(lanes.map((p) => [p.text, p.lane])).toEqual([
      ['C', 'chord'],
      ['Coda', 'text'],
      ['two', 'lyric:1'],
    ]);
  });

  for (const notation of ['tab', 'standard', 'both'] as const) {
    it(`give the baselines of drawn words on the staff that draws them (${notation})`, () => {
      const result = laid(built(true), notation);
      const drawing = result.systems[0]?.staves.filter((s) => s.words);
      expect(drawing).toHaveLength(1);
      expect(drawing?.[0]?.type).toBe(notation === 'standard' ? 'standard' : 'tab');
      const words = drawing?.[0]?.words;
      const at = (lane: string) => texts(result).find((p) => p.lane === lane)?.y;
      expect(words?.chord).toBe(at('chord'));
      expect(words?.text).toBe(at('text'));
      expect(words ? words.lyrics + words.lyricRow : undefined).toBe(at('lyric:1'));
    });

    it(`put an empty row where a word would go once the bar has one (${notation})`, () => {
      const rows = (words: boolean) => {
        const staff = laid(built(words), notation).systems[0]?.staves.find((s) => s.words);
        if (!staff?.words) throw new Error('no words');
        // Distances from the staff, since the words move the staff down the page.
        return {
          chord: staff.top - staff.words.chord,
          lyrics: staff.words.lyrics - staff.bottom,
        };
      };
      const [empty, full] = [rows(false), rows(true)];
      expect(empty.chord).toBeCloseTo(full.chord, 1);
      expect(empty.lyrics).toBeCloseTo(full.lyrics, 1);
    });
  }
});

const SPACE = 10;

function beatWith(lyrics: string[]) {
  const built = score()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)], { lyrics })
    .build({ ids: 'sequential' });
  const beat = built.tracks[0]?.bars[0]?.voices[0]?.beats[0];
  if (!beat) throw new Error('no beat');
  return beat;
}

describe('wordsExtent of syllables', () => {
  it('reserves nothing for an empty syllable', () => {
    expect(wordsExtent(beatWith(['']), 0, SPACE, true)).toEqual({ left: 0, right: 0 });
    expect(wordsExtent(beatWith(['', 'la']), 0, SPACE, true)).toEqual(
      wordsExtent(beatWith(['la']), 0, SPACE, true),
    );
  });

  it('measures a hyphenated syllable without its hyphen and reserves the hyphen after it', () => {
    const size = WORDS.size * SPACE;
    const gap = WORDS.gap * SPACE;
    const { left, right } = wordsExtent(beatWith(['lo-']), 0, SPACE, true);
    expect(left).toBeCloseTo(textWidth('lo', size) / 2 + gap, 5);
    expect(right).toBeCloseTo(left + textWidth('-', size) + gap, 5);
  });
});

describe.each(['tab', 'standard'] as const)('words on a %s staff, placement', (notation) => {
  const dashes = (result: LayoutResult) =>
    texts(result).filter((p) => p.text === '-' && p.lane === undefined);
  const lane = (result: LayoutResult, text: string) =>
    texts(result).find((p) => p.text === text && p.lane !== undefined);
  const barAnchors = (result: LayoutResult) =>
    result.anchors.filter((a) => a.kind === 'bar' && a.track !== undefined);
  const beatAnchors = (result: LayoutResult) =>
    result.anchors.filter((a) => a.kind === 'beat').map((a) => a.bbox.x + a.bbox.width / 2);

  it('keeps a whole-bar rest name out of the next bar and starts it at the onset', () => {
    const built = score()
      .track('guitar')
      .bar()
      .rest('1', { chord: { name: 'N.C. long chord name here' } })
      .bar()
      .beat('4', [note(1, 0)], { chord: { name: 'Am' } })
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .build({ ids: 'sequential' });
    const result = laid(built, notation);
    const name = texts(result).find((p) => p.text === 'N.C. long chord name here');
    const am = texts(result).find((p) => p.text === 'Am');
    if (!name || !am) throw new Error('words missing');
    const size = name.size;
    expect(name.x + textWidth(name.text, size)).toBeLessThan(am.x);
    const [bar] = barAnchors(result);
    const rest = result.anchors.find((a) => a.kind === 'beat');
    if (!bar || !rest) throw new Error('no bar');
    // The name starts left of the centred rest, which keeps the middle of the bar's content.
    expect(name.x).toBeLessThan(rest.bbox.x);
    const centre = rest.bbox.x + rest.bbox.width / 2;
    expect(centre).toBeGreaterThan(bar.bbox.x + bar.bbox.width * 0.4);
    expect(centre).toBeLessThan(bar.bbox.x + bar.bbox.width * 0.9);
  });

  it('centres the syllable of a whole-bar rest on its onset, not on the bar', () => {
    const built = score()
      .track('guitar')
      .bar()
      .rest('1', { lyrics: ['la'] })
      .build({ ids: 'sequential' });
    const result = laid(built, notation);
    const sung = lane(result, 'la');
    const rest = result.anchors.find((a) => a.kind === 'beat');
    if (!sung || !rest) throw new Error('missing');
    expect(sung.x).toBeLessThan(rest.bbox.x + rest.bbox.width / 2 - 1);
  });

  it('spaces a bar the same whether its other beats carry empty syllables or none', () => {
    const make = (empty: boolean) => {
      const b = score()
        .track('guitar')
        .bar()
        .beat('64', [note(1, 0)], { lyrics: ['la'] });
      for (let i = 0; i < 31; i++) {
        b.beat('64', [note(1, 0)], empty ? { lyrics: [''] } : {});
      }
      return b.build({ ids: 'sequential' });
    };
    expect(beatAnchors(laid(make(true), notation))).toEqual(
      beatAnchors(laid(make(false), notation)),
    );
  });

  it('draws a hyphen centred between two syllables, with the beat as node and no lane', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], { lyrics: ['lo-'] })
      .beat('4', [note(1, 0)], { lyrics: ['ve'] })
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .build({ ids: 'sequential' });
    const result = laid(built, notation);
    const lo = lane(result, 'lo');
    const ve = lane(result, 've');
    const [dash, ...more] = dashes(result);
    if (!lo || !ve || !dash) throw new Error('missing');
    expect(more).toHaveLength(0);
    expect(lane(result, 'lo-')).toBeUndefined();
    expect(dash.node).toBe(lo.node);
    expect(dash.y).toBe(lo.y);
    const size = lo.size;
    const loRight = lo.x + textWidth('lo', size) / 2;
    const veLeft = ve.x - textWidth('ve', size) / 2;
    expect(Math.abs(dash.x - (loRight + veLeft) / 2)).toBeLessThan(0.5);
    expect(veLeft - loRight).toBeGreaterThanOrEqual(
      textWidth('-', size) + 2 * WORDS.gap * (size / WORDS.size) - 1e-6,
    );
  });

  it('spans a melisma and a bar line within a system', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)], { lyrics: ['Twin-'] })
      .bar()
      .beat('4', [note(1, 0)], { lyrics: ['kle'] })
      .beat('4', [note(1, 0)], { lyrics: ['lit-'] })
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)], { lyrics: [''] })
      .bar()
      .beat('4', [note(1, 0)], { lyrics: ['tle'] })
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .build({ ids: 'sequential' });
    const result = laid(built, notation);
    expect(result.systems).toHaveLength(1);
    const size = lane(result, 'Twin')?.size ?? 0;
    const edge = (text: string, side: 1 | -1) => {
      const p = lane(result, text);
      if (!p) throw new Error(text);
      return p.x + (side * textWidth(text, size)) / 2;
    };
    const across = dashes(result).find((d) => d.node === lane(result, 'Twin')?.node);
    if (!across) throw new Error('no hyphen');
    expect(across.x).toBeGreaterThan(edge('Twin', 1));
    expect(across.x).toBeLessThan(edge('kle', -1));
    expect(Math.abs(across.x - (edge('Twin', 1) + edge('kle', -1)) / 2)).toBeLessThan(0.5);
    const held = dashes(result).find((d) => d.node === lane(result, 'lit')?.node);
    if (!held) throw new Error('no melisma hyphen');
    expect(Math.abs(held.x - (edge('lit', 1) + edge('tle', -1)) / 2)).toBeLessThan(0.5);
  });

  it('puts the hyphen right after the syllable at a system end, inside the bar', () => {
    const b = score().track('guitar');
    for (let i = 0; i < 12; i++) {
      b.bar()
        .beat('4', [note(1, 0)], { lyrics: [i === 0 ? 'a' : 'Twin-'] })
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)])
        .beat('4', [note(1, 0)]);
    }
    const result = laid(b.build({ ids: 'sequential' }), notation);
    expect(result.systems.length).toBeGreaterThan(1);
    const firstBars = barAnchors(result).filter((a) => a.system === 0);
    const lastBar = firstBars.at(-1);
    if (!lastBar) throw new Error('no bar');
    const content = lastBar.bbox.x + lastBar.bbox.width;
    const ends = texts(result).filter(
      (p) => p.text === 'Twin' && p.x < content && p.x > lastBar.bbox.x,
    );
    // The last bar of a system carries 'Twin-' on its first beat, with its hyphen right after it.
    const twin = ends.at(-1);
    const dash = dashes(result).find((d) => d.node === twin?.node);
    if (!twin || !dash) throw new Error('missing');
    const size = twin.size;
    const space = size / WORDS.size;
    expect(dash.x).toBeCloseTo(
      twin.x + textWidth('Twin', size) / 2 + WORDS.gap * space + textWidth('-', size) / 2,
      1,
    );
    expect(dash.x + textWidth('-', size) / 2).toBeLessThanOrEqual(content + 1e-6);
  });

  it('draws a lone hyphen syllable as it is, and hyphenates each line on its own', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)], { lyrics: ['-'] })
      .beat('4', [note(1, 0)], { lyrics: ['Twin-', 'Ein-'] })
      .beat('4', [note(1, 0)], { lyrics: ['kle', 'sam'] })
      .beat('4', [note(1, 0)])
      .build({ ids: 'sequential' });
    const result = laid(built, notation);
    const lone = texts(result).filter((p) => p.text === '-' && p.lane === 'lyric:0');
    expect(lone).toHaveLength(1);
    expect(dashes(result)).toHaveLength(2);
    const ys = new Set(dashes(result).map((d) => d.y));
    expect(ys.size).toBe(2);
  });

  it('cuts a hyphenated syllable with an ellipsis before it drops its hyphen, in a squeezed bar', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 0)], { lyrics: ['Wonderful-'] })
      .build({ ids: 'sequential' });
    const track = built.tracks[0];
    let cut = false;
    const bars: number[] = [];
    for (const width of [150, 200, 240, 280, 340]) {
      const result = layout(built, {
        ...paged,
        width,
        notation: track ? { [track.id]: notation } : {},
      });
      const [bar] = barAnchors(result);
      const sung = texts(result).find((p) => p.lane === 'lyric:0');
      if (!bar || !sung) continue;
      const content = bar.bbox.x + bar.bbox.width;
      const dash = dashes(result)[0];
      bars.push(sung.text === 'Wonderful' ? 1 : 0);
      // Whatever the width, the syllable is cut before the hyphen goes: a drawn syllable that is
      // not cut has its hyphen, and nothing passes the content end.
      expect(dash).toBeDefined();
      cut ||= sung.text.endsWith('…');
      if (dash) expect(dash.x + textWidth('-', dash.size) / 2).toBeLessThanOrEqual(content + 1e-6);
      expect(sung.x + textWidth(sung.text, sung.size) / 2).toBeLessThanOrEqual(content + 1e-6);
    }
    expect(bars.length).toBeGreaterThan(0);
    expect(cut).toBe(true);
  });
});

describe('drawWords with a chord diagram', () => {
  const beat = {
    id: 'beat-1',
    chord: { name: 'C', diagram: { baseFret: 1, frets: [0, 1, 0, 2, 3, null] } },
  } as unknown as Beat;
  const lanes = { chordDiagram: { top: 20, bottom: 90 }, chord: { top: 0, bottom: 20 } };
  const drawn = (x: number, limit: number) => {
    const sink: LayoutSink = { primitives: [], anchors: [] };
    drawWords(sink, lanes, beat, { x, start: 0, space: 10, limit, diagrams: true });
    return sink.primitives.filter((p) => p.kind === 'path' && p.lane === 'chordDiagram');
  };
  const width = chordDiagramSize({ baseFret: 1, frets: [0, 1, 0, 2, 3, null] }, 10).width;

  it('draws the grid at the name, top-aligned in its lane', () => {
    const [grid] = drawn(100, Infinity);
    expect(grid?.bbox.x).toBe(100);
    expect(grid?.bbox.y).toBe(20);
  });

  it('shifts left to fit the system end, never more than half its width from the beat', () => {
    const [grid] = drawn(100, 100 + width - 10);
    expect(grid?.bbox.x).toBeCloseTo(90, 1);
    expect(drawn(100, 100 + width / 2 - 1)).toHaveLength(0);
  });

  it('draws nothing with diagrams off or without the lane', () => {
    const sink: LayoutSink = { primitives: [], anchors: [] };
    drawWords(sink, lanes, beat, { x: 100, start: 0, space: 10, limit: Infinity, diagrams: false });
    expect(sink.primitives.some((p) => p.kind === 'path')).toBe(false);
    const bare: LayoutSink = { primitives: [], anchors: [] };
    drawWords(bare, { chord: lanes.chord }, beat, {
      x: 100,
      start: 0,
      space: 10,
      limit: Infinity,
      diagrams: true,
    });
    expect(bare.primitives.some((p) => p.kind === 'path')).toBe(false);
  });

  it('asks for the lane and the room only when diagrams are on', () => {
    expect(wordRows([beat], 10, true).chordDiagram).toBeGreaterThan(0);
    expect(wordRows([beat], 10, false).chordDiagram).toBe(0);
    expect(wordLanes(wordRows([beat], 10, false)).chordDiagram).toBeUndefined();
    expect(wordsExtent(beat, 0, 10, true).right).toBeGreaterThan(
      wordsExtent(beat, 0, 10, false).right,
    );
    expect(wordsExtent(beat, 0, 10, true).right).toBeCloseTo(width + WORDS.gap * 10, 1);
  });
});
