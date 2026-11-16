import { score, midi, note } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { PAGE_SIZES, layout, type LayoutOptions, type LayoutResult } from '../index';
import { expectValid } from '../test/check-result';
import { standardModule } from './standard';
import type { StaffBar } from './staff-module';
import { wordLanes, wordRows } from './words';

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
    const rows = wordRows(beats, 10);
    expect(rows.chord).toBe(0);
    expect(rows.text).toBeGreaterThan(0);
    expect(rows.lyrics).toBeCloseTo(3 * 2 * 10, 5);
    expect(wordLanes(rows)).toEqual({ text: rows.text, lyrics: rows.lyrics });
    expect(wordLanes(wordRows([], 10))).toEqual({});
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
    const first = drawn.find((p) => p.text === 'Twin-');
    const second = drawn.find((p) => p.text === 'Ein');
    expect(first?.node).toBe(beatIds[0]);
    expect(first?.anchor).toBe('middle');
    expect(first?.y ?? 0).toBeGreaterThan(bottom);
    expect(second?.y ?? 0).toBeGreaterThan(first?.y ?? Infinity);
    expect(first?.x).toBe(second?.x);
    // Every syllable of one lyric line sits on one baseline.
    const line = (text: string) => drawn.filter((p) => p.text === text).map((p) => p.y);
    expect(
      new Set([...line('Twin-'), ...line('kle'), ...line('twin-'), ...line('lit-')]).size,
    ).toBe(1);
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
    const spoken = ['Am7', 'D', 'riff', 'Twin-', 'Ein', 'kle', 'twin-', 'lit-'];
    const drawn = texts(result).filter((p) => spoken.includes(p.text));
    expect(drawn).toHaveLength(9);
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
