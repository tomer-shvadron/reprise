import { read, write } from '@reprise/formats';
import { applyCommand, setTrackProperties } from '@reprise/model';
import {
  PAGE_SIZES,
  anchorBox,
  layout,
  type LayoutResult,
  type TextPrimitive,
} from '@reprise/layout';
import { beatOf } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';
import { wordFieldRect } from './geometry';
import { must } from './test/must';
import { wordScore } from './test/word-scores';
import { openWord, stepWord } from './word-session';
import { planWord } from './words';

/**
 * WP-085's acceptance criterion "lyrics entered across a verse render aligned": a verse typed
 * with spaces and hyphens lands on the played beats (the rest and the empty beat are skipped),
 * and every syllable is drawn centred on its beat, on one baseline per system.
 */
describe('lyrics entered across a verse', () => {
  it.each(['tab', 'standard'] as const)('render aligned on the %s staff', async (notation) => {
    const services = createTestServices();
    const { document, selection, entry, editing } = services;
    await document
      .getState()
      .openBytes('verse.reprise', (await write(wordScore(), 'reprise')).bytes);
    editing.getState().setEditing(true);
    const opened = must(document.getState().score);
    selection.getState().setEdit({
      cursor: must(
        cursorAtPosition(
          opened,
          { track: 0, bar: 0, voice: 0, stop: 0 },
          { string: 1, staff: 'tab' },
        ),
      ),
    });

    expect(openWord(services, 'lyric')).toBe(true);
    const verse = ['Twin-', 'kle', 'twin-', 'kle', 'lit-', 'tle', 'star'];
    for (const syllable of verse) {
      // What a typed syllable then Space (or the hyphen) leaves in the draft is the syllable with its hyphen.
      entry.getState().setWord({ ...must(entry.getState().word), draft: syllable });
      expect(stepWord(services, 1)).toBe(true);
    }

    const score = must(document.getState().score);
    const played = score.tracks[0]?.bars.flatMap((bar) =>
      bar.voices[0].beats.filter((beat) => !beat.rest && beat.notes.length > 0),
    );
    expect(played?.slice(0, 7).map((beat) => beat.lyrics?.[0])).toEqual(verse);
    expect(played?.slice(7).every((beat) => beat.lyrics === undefined)).toBe(true);

    const result: LayoutResult = layout(score, {
      mode: 'paged',
      width: PAGE_SIZES.a4.width,
      zoom: 1,
      tracks: 'all',
      notation: { [must(score.tracks[0]).id]: notation },
    });
    const baselines = new Map<number, Set<number>>();
    for (const [index, beat] of (played ?? []).slice(0, 7).entries()) {
      const syllable = must(
        result.primitives.find(
          (p): p is TextPrimitive =>
            p.kind === 'text' && p.node === beat.id && p.lane === 'lyric:0',
        ),
      );
      // The hyphen is stored on the syllable and drawn apart from it, centred toward the next one.
      expect(syllable.text).toBe(verse[index]?.replace(/-$/, ''));
      const anchor = must(result.anchors.find((a) => a.kind === 'beat' && a.id === beat.id));
      const box = anchorBox(result, anchor);
      expect(syllable.x).toBeCloseTo(box.x + box.width / 2, 0);
      // The field for that syllable sits on the same x and baseline.
      const rect = must(
        wordFieldRect(result, {
          kind: 'lyric',
          trackId: must(score.tracks[0]).id,
          beatId: beat.id,
          line: 0,
        }),
      );
      expect(rect.x).toBeCloseTo(syllable.x, 0);
      expect(rect.y + rect.size * 1.1).toBeCloseTo(syllable.y, 1);
      const set = baselines.get(anchor.system) ?? new Set<number>();
      set.add(syllable.y);
      baselines.set(anchor.system, set);
    }
    for (const set of baselines.values()) expect(set.size).toBe(1);
    // The rest and the empty beat after the first two were skipped.
    expect(beatOf(score, 0, 0, 2).lyrics).toBeUndefined();
    expect(beatOf(score, 0, 0, 3).lyrics).toBeUndefined();
  });
});

describe('a lyric edited and then deleted on a track with a raw block', () => {
  it('does not come back through a gp export and the reader', async () => {
    const built = wordScore();
    const trackId = must(built.tracks[0]).id;
    let current = applyCommand(
      built,
      setTrackProperties({ trackId }, { lyrics: [{ startBar: 0, text: 'old words here' }] }),
    ).score;
    const beatId = must(current.tracks[0]?.bars[0]?.voices[0]?.beats[0]).id;
    for (const value of ['new', '']) {
      const plan = planWord(current, { kind: 'lyric', beatId, line: 0, value });
      if (!('command' in plan)) throw new Error('no command');
      current = applyCommand(current, plan.command).score;
    }
    const back = (await read((await write(current, 'gp')).bytes, 'gp')).score;
    expect(back.tracks[0]?.lyrics.filter((line) => line.text.trim() !== '')).toEqual([]);
    const lyrics = back.tracks[0]?.bars.flatMap((bar) =>
      bar.voices[0].beats.flatMap((beat) => beat.lyrics ?? []),
    );
    expect(lyrics?.filter((syllable) => syllable !== '')).toEqual([]);
  });
});
