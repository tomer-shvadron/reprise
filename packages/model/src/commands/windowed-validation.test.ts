import { produce } from 'immer';
import { describe, expect, it } from 'vitest';

import { createBeat, createNote } from '../factories';
import { applyCommand, createHistory } from '../history';
import type { Command } from '../history';
import type { Score } from '../score';
import { fullScore, largeScore, note, score } from '../testing';
import { validateScore, validateTrackBars } from '../validate';
import type { Violation, ViolationRule } from '../validate';
import { chain } from './chain';
import {
  insertBeat,
  removeBeat,
  replaceBeats,
  setBeatDuration,
  setBeatDurations,
  setBeatEffect,
  setBeatRest,
} from './beat-commands';
import { assertBarsValid, assertFreshIds } from './checks';
import { CommandError } from './command-error';
import { setNote } from './note-commands';
import { beatOf, buildScore, expectRefusal, noteOf, roundTrip } from './test-score';

const NOT_PER_BAR: ViolationRule[] = ['duplicate-id', 'bar-count', 'track-kind'];

function perBar(violations: Violation[], track: number): Violation[] {
  return violations.filter((v) => v.path[0] === 'tracks' && v.path[1] === track);
}

/** Six bars on one guitar; the tie in bar 3 continues the note struck in bar 0. */
function heldAcrossBars(): Score {
  return score()
    .tempo(120)
    .track('guitar')
    .bar()
    .beat('4', [note(2, 5)])
    .beat('4', [note(1, 3)])
    .bar()
    .beat('4', [note(1, 3)])
    .bar()
    .beat('4', [note(1, 3)])
    .bar()
    .beat('4', [note(2, 5, { tie: true })])
    .bar()
    .beat('4', [note(1, 3)])
    .bar()
    .beat('4', [note(1, 3)])
    .build();
}

/** Violations of several rules, in several bars and tracks, for edits that must tolerate them. */
function seededViolations(): Score {
  return score()
    .tempo(120)
    .track('guitar')
    .bar()
    .beat('4', [note(1, 1)])
    .beat('4', [note(2, 2)])
    .bar()
    .beat('1', [note(1, 0)])
    .beat('4', [note(1, 0)])
    .bar()
    .beat('4', [note(2, 5)])
    .beat('4', [note(2, 6)])
    .beat('4', [note(2, 7)])
    .beat('4', [note(2, 8)])
    .bar()
    .beat('4', [note(3, 3, { tie: true })])
    .bar()
    .beat('4', [note(1, 30)])
    .beat('2', [note(1, 2)])
    .bar()
    .track('guitar')
    .bar()
    .beat('4', [note(1, 40)])
    .beat('4', [note(2, 2)])
    .bar()
    .beat('4', [note(2, 2, { tie: true })])
    .bar()
    .bar()
    .bar()
    .bar()
    .build({ validate: false });
}

describe('validateTrackBars', () => {
  it('over every bar equals the whole-track rules of validateScore', () => {
    for (const source of [fullScore(), seededViolations(), buildScore()]) {
      const all = source.tracks[0]?.bars.map((_, b) => b) ?? [];
      source.tracks.forEach((track, t) => {
        const bars = track.bars.map((_, b) => b);
        expect(all.length).toBeGreaterThan(0);
        expect(validateTrackBars(source, t, bars)).toEqual(
          perBar(validateScore(source), t).filter((v) => !NOT_PER_BAR.includes(v.rule)),
        );
      });
    }
  });

  it('the seeded score carries several per-bar rules', () => {
    const rules = new Set(validateScore(seededViolations()).map((v) => v.rule));
    expect(rules).toEqual(new Set(['voice-overfull', 'fret-range', 'tie-target']));
  });
});

describe('bar-windowed validation in beat commands', () => {
  it('still refuses an insert that overfills a voice, in the first and the last bar', () => {
    const source = largeScore(2, 20);
    for (const bar of [0, 10, 19]) {
      const voice = source.tracks[0]?.bars[bar]?.voices[0];
      if (!voice) throw new Error('no voice');
      // A bar of the large score is full, so one more beat cannot fit.
      expectRefusal(
        source,
        insertBeat(
          { voiceId: voice.id, index: 0 },
          { duration: 1, notes: [createNote({ string: 1, fret: 0 })] },
        ),
        'invariant',
      );
    }
  });

  it('refuses lengthening a beat past the bar, and accepts shortening it', () => {
    const source = buildScore();
    const id = beatOf(source, 0, 0, 0).id;
    expectRefusal(source, setBeatDuration({ beatId: id }, { duration: 1 }), 'invariant');
    roundTrip(source, setBeatDuration({ beatId: id }, { duration: 8 }));
  });

  it('refuses a tie a bar edit breaks three bars ahead, and does not look further', () => {
    const source = heldAcrossBars();
    const edit = (bar: number, fret: number): void => {
      produce(source, (draft) => {
        const target = draft.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0];
        if (!target) throw new Error('no note');
        target.fret = fret;
        assertBarsValid(draft, 0, [bar], 'probe');
      });
    };
    expect(() => {
      edit(0, 7);
    }).toThrow(/tie-pitch at tracks\.0\.bars\.3/);
    // Bar 4 is past the tie's reach from bar 0, so the window does not include bar 3 from there.
    expect(() => {
      edit(4, 7);
    }).not.toThrow();
  });

  it('tolerates violations the file already carried, in the touched bar, the track and another track', () => {
    const source = seededViolations();
    const before = validateScore(source).length;
    expect(before).toBeGreaterThan(2);
    const first = beatOf(source, 0, 0, 0);
    const { score: after } = applyCommand(
      source,
      setBeatDuration({ beatId: first.id }, { duration: 8 }),
    );
    expect(validateScore(after)).toHaveLength(before);
    // The overfull bar 1 is the touched bar here: an unrelated edit in it is allowed...
    const inBar = beatOf(source, 0, 1, 1);
    expect(() =>
      applyCommand(source, setBeatDuration({ beatId: inBar.id }, { dots: 0 })),
    ).not.toThrow();
    // ...but overfilling another bar of the same track is not.
    expectRefusal(
      source,
      setBeatDuration({ beatId: beatOf(source, 0, 2, 0).id }, { duration: 1 }),
      'invariant',
    );
    // And the other track's bar 0 carries a fret-range violation an edit to its sibling beat tolerates.
    const sibling = beatOf(source, 1, 0, 1);
    expect(() =>
      applyCommand(source, setBeatDuration({ beatId: sibling.id }, { duration: 8 })),
    ).not.toThrow();
  });
});

describe('assertFreshIds', () => {
  it('refuses an id the score uses, whatever kind of node holds it, and a repeat inside the list', () => {
    const base = buildScore();
    const { score: source } = applyCommand(
      base,
      setBeatEffect(
        { beatId: beatOf(base, 0, 0, 0).id },
        { grace: [{ duration: 16, before: true, notes: [createNote({ string: 2, fret: 4 })] }] },
      ),
    );
    const track = source.tracks[0];
    const bar = track?.bars[0];
    const voice = bar?.voices[0];
    const beat = beatOf(source, 0, 0, 0);
    const grace = beat.grace?.[0]?.notes[0];
    const ids = [
      source.id,
      source.masterBars[0]?.id,
      track?.id,
      bar?.id,
      voice?.id,
      beat.id,
      noteOf(source, 0, 0, 0).id,
      grace?.id,
    ];
    expect(ids.every((id) => id !== undefined)).toBe(true);
    for (const id of ids) {
      expect(() => {
        assertFreshIds(source, ['fresh-one', id ?? ''], 'probe');
      }).toThrow(`id ${id ?? ''} is already used`);
    }
    expect(() => {
      assertFreshIds(source, ['a', 'b', 'a'], 'probe');
    }).toThrow(expect.objectContaining({ code: 'duplicate-id' }));
    expect(() => {
      assertFreshIds(source, ['a', 'b'], 'probe');
    }).not.toThrow();
  });

  it('refuses an inserted beat whose note shares its id, or an id the score uses', () => {
    const source = buildScore();
    const voiceId = source.tracks[0]?.bars[1]?.voices[0]?.id ?? '';
    const clash = { ...createNote({ string: 1, fret: 2 }), id: 'sameIdForBoth' };
    expectRefusal(
      source,
      insertBeat({ voiceId, index: 1, id: 'sameIdForBoth' }, { duration: 8, notes: [clash] }),
      'duplicate-id',
    );
    expectRefusal(
      source,
      insertBeat(
        { voiceId, index: 1, id: beatOf(source, 0, 0, 0).id },
        { duration: 8, notes: [createNote({ string: 1, fret: 2 })] },
      ),
      'duplicate-id',
    );
  });
});

describe('setBeatDurations', () => {
  it('halves a range in one history step and names the touched bars', () => {
    const source = buildScore();
    const edits = [0, 1, 3].map((i) => ({
      beatId: beatOf(source, 0, 0, i).id,
      rhythm: { duration: 8 as const },
    }));
    const applied = roundTrip(source, chain('setRhythm', [setBeatDurations(edits)]));
    expect(applied.change.touchedBars).toEqual([source.masterBars[0]?.id]);
    expect(beatOf(applied.score, 0, 0, 1).duration).toBe(8);
  });

  it('matches a chain of setBeatDuration when the chain is accepted', () => {
    const source = largeScore(2, 20);
    const beats = source.tracks[1]?.bars[7]?.voices[0]?.beats ?? [];
    const rhythm = { duration: 16 as const };
    const batched = applyCommand(
      source,
      setBeatDurations(beats.map((b) => ({ beatId: b.id, rhythm }))),
    );
    const chained = applyCommand(
      source,
      chain(
        'c',
        beats.map((b) => setBeatDuration({ beatId: b.id }, rhythm)),
      ),
    );
    expect(batched.score).toEqual(chained.score);
    expect(batched.change.touchedBars).toEqual(chained.change.touchedBars);
  });

  it('touches the union of the bars across tracks', () => {
    const source = buildScore();
    const { change } = applyCommand(
      source,
      setBeatDurations([
        { beatId: beatOf(source, 0, 0, 0).id, rhythm: { duration: 8 } },
        { beatId: beatOf(source, 0, 2, 0).id, rhythm: { duration: 8 } },
      ]),
    );
    expect(change.touchedBars).toEqual([source.masterBars[0]?.id, source.masterBars[2]?.id]);
  });

  it('accepts a batch that fits only in its end state, as the end state is what is validated', () => {
    const source = buildScore();
    // Lengthen the last beat first and shorten the first after: the middle overfills, the end fits.
    const last = beatOf(source, 0, 0, 3);
    const first = beatOf(source, 0, 0, 0);
    expect(() =>
      applyCommand(
        source,
        setBeatDurations([
          { beatId: last.id, rhythm: { duration: 2 } },
          { beatId: first.id, rhythm: { duration: 8 } },
          { beatId: beatOf(source, 0, 0, 1).id, rhythm: { duration: 8 } },
        ]),
      ),
    ).not.toThrow();
  });

  it('refuses an empty list, a repeat, an unknown beat, a bad value and an overfill', () => {
    const source = buildScore();
    const id = beatOf(source, 0, 0, 0).id;
    expectRefusal(source, setBeatDurations([]), 'invalid-value');
    expectRefusal(
      source,
      setBeatDurations([
        { beatId: id, rhythm: { duration: 8 } },
        { beatId: id, rhythm: { duration: 8 } },
      ]),
      'invalid-value',
    );
    expectRefusal(
      source,
      setBeatDurations([{ beatId: 'missing', rhythm: { duration: 8 } }]),
      'not-found',
    );
    // @ts-expect-error a dots value the type forbids, to reach the schema check
    const bad = setBeatDurations([{ beatId: id, rhythm: { dots: 7 } }]);
    expectRefusal(source, bad, 'invalid-value');
    let error: unknown;
    try {
      applyCommand(source, bad);
    } catch (thrown) {
      error = thrown;
    }
    expect(error instanceof Error && error.message.includes(`beat ${id}`)).toBe(true);
    expectRefusal(source, setBeatDurations([{ beatId: id, rhythm: { duration: 1 } }]), 'invariant');
  });
});

/** mulberry32: a seeded generator so a failure replays. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ruleCounts(source: Score): Map<ViolationRule, number> {
  const counts = new Map<ViolationRule, number>();
  for (const v of validateScore(source)) counts.set(v.rule, (counts.get(v.rule) ?? 0) + 1);
  return counts;
}

describe('windowed validation agrees with full validation', () => {
  it.each([11, 12, 13, 14])(
    'seed %i: no applied beat command raises the count of any rule over the whole score',
    (seed) => {
      const next = random(seed);
      const int = (max: number): number => Math.floor(next() * max);
      let current = seed % 2 === 0 ? seededViolations() : heldAcrossBars();
      const history = createHistory();
      let refused = 0;
      let applied = 0;
      for (let step = 0; step < 250; step++) {
        const located = current.tracks.flatMap((track, t) =>
          track.bars.flatMap((bar, b) =>
            bar.voices.flatMap((voice) =>
              voice.beats.map((beat, index) => ({ track, t, b, voice, beat, index })),
            ),
          ),
        );
        const pickBeat = () => located[int(located.length)];
        const voices = current.tracks.flatMap((track) =>
          track.bars.flatMap((bar) => bar.voices.map((voice) => ({ track, voice }))),
        );
        const target = pickBeat();
        const v = voices[int(voices.length)];
        if (!target || !v) break;
        const commands: Command[] = [
          insertBeat(
            { voiceId: v.voice.id, index: int(v.voice.beats.length + 1) },
            {
              duration: ([4, 8, 16, 2] as const)[int(4)] ?? 4,
              notes: next() < 0.6 ? [createNote({ string: 1 + int(3), fret: int(8) })] : [],
            },
          ),
          removeBeat({ beatId: target.beat.id }),
          setBeatRest({ beatId: target.beat.id }, next() < 0.5),
          setBeatDuration(
            { beatId: target.beat.id },
            {
              duration: ([2, 4, 8, 16] as const)[int(4)] ?? 4,
              dots: ([0, 1] as const)[int(2)] ?? 0,
            },
          ),
          setBeatDurations(
            located
              .filter((l) => l.voice === target.voice)
              .map((l) => ({ beatId: l.beat.id, rhythm: { duration: 8 as const } })),
          ),
          setNote(
            { beatId: target.beat.id },
            { string: 1 + int(3), fret: int(8), tie: next() < 0.5 },
          ),
          setBeatEffect(
            { beatId: target.beat.id },
            {
              grace: [
                {
                  duration: 16,
                  before: true,
                  notes: [createNote({ string: 1 + int(3), fret: int(30) })],
                },
              ],
            },
          ),
          replaceBeats([
            {
              voiceId: v.voice.id,
              index: 0,
              remove: int(v.voice.beats.length + 1),
              beats: [
                createBeat({ duration: 4, notes: [createNote({ string: 1, fret: int(8) })] }),
              ],
            },
          ]),
        ];
        const command = commands[int(commands.length)];
        if (!command) break;
        const before = ruleCounts(current);
        try {
          const result = history.apply(current, command);
          for (const [rule, count] of ruleCounts(result.score)) {
            expect(count, `${command.name} raised ${rule}`).toBeLessThanOrEqual(
              before.get(rule) ?? 0,
            );
          }
          current = result.score;
          applied += 1;
        } catch (error) {
          if (!(error instanceof CommandError)) throw error;
          refused += 1;
        }
      }
      expect(applied).toBeGreaterThan(20);
      expect(refused).toBeGreaterThan(0);
    },
  );
});
