import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';

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
  setBeatEffects,
  setBeatRest,
} from './beat-commands';
import { assertBarsValid, assertFreshIds } from './checks';
import { CommandError } from './command-error';
import { setNote } from './note-commands';
import { beatOf, buildScore, expectRefusal, noteOf, roundTrip } from './test-score';

// The reference decision: with `whole` set, the commands' bar-windowed check runs the whole-track
// one instead, so the same recipe can be judged both ways on the same input.
const reference = vi.hoisted(() => ({ whole: false }));
vi.mock('./checks', async (importOriginal) => {
  const original = await importOriginal<typeof import('./checks')>();
  return {
    ...original,
    assertBarsValid: (...args: Parameters<typeof original.assertBarsValid>) => {
      if (reference.whole) original.assertTrackValid(args[0], args[1], args[3]);
      else original.assertBarsValid(...args);
    },
  };
});

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

  it('refuses a tie a bar edit breaks three bars ahead, inside the window', () => {
    const source = heldAcrossBars();
    expect(() => {
      produce(source, (draft) => {
        const target = draft.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0];
        if (!target) throw new Error('no note');
        target.fret = 7;
        assertBarsValid(draft, 0, [0], 'probe');
      });
    }).toThrow(/tie-pitch at tracks\.0\.bars\.3/);
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

describe('grace lists that repeat an id', () => {
  const withGrace = (source: Score) => {
    const beatId = beatOf(source, 0, 0, 0).id;
    const g = createNote({ string: 2, fret: 4 });
    const { score: kept } = applyCommand(
      source,
      setBeatEffect({ beatId }, { grace: [{ duration: 16, before: true, notes: [g] }] }),
    );
    const twice = [
      { duration: 16 as const, before: true, notes: [g] },
      { duration: 16 as const, before: true, notes: [{ ...g, string: 3 }] },
    ];
    const oneBeat = [{ duration: 16 as const, before: true, notes: [g, { ...g, string: 3 }] }];
    return { kept, beatId, twice, oneBeat };
  };

  it('are refused by setBeatEffect and setBeatEffects, kept id or not, as the whole track was', () => {
    const { kept, beatId, twice, oneBeat } = withGrace(buildScore());
    for (const grace of [twice, oneBeat]) {
      for (const command of [
        setBeatEffect({ beatId }, { grace }),
        setBeatEffects([{ beatId, changes: { grace } }]),
      ]) {
        expectRefusal(kept, command, 'invariant');
        expect(() => applyCommand(kept, command)).toThrow(/duplicate-id at tracks\.0\.bars\.0/);
      }
    }
    // A new id repeated is refused too.
    const fresh = createNote({ string: 2, fret: 4 });
    expectRefusal(
      kept,
      setBeatEffect(
        { beatId },
        { grace: [{ duration: 16, before: true, notes: [fresh, { ...fresh, string: 3 }] }] },
      ),
      'invariant',
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

  it('touches the union of the bars across two tracks, validating each', () => {
    const source = buildScore();
    const { change } = applyCommand(
      source,
      setBeatDurations([
        { beatId: beatOf(source, 0, 2, 0).id, rhythm: { duration: 8 } },
        { beatId: beatOf(source, 1, 0, 0).id, rhythm: { duration: 8 } },
      ]),
    );
    expect(change.touchedBars).toEqual([source.masterBars[0]?.id, source.masterBars[2]?.id]);
    // An overfill on the second track refuses the whole batch, though the first track's edit is fine.
    const full = largeScore(2, 3);
    expectRefusal(
      full,
      setBeatDurations([
        { beatId: beatOf(full, 0, 1, 0).id, rhythm: { duration: 16 } },
        { beatId: beatOf(full, 1, 1, 0).id, rhythm: { duration: 1 } },
      ]),
      'invariant',
    );
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

type Outcome = { ok: true; score: Score } | { ok: false; code: string };

function outcomeOf(source: Score, command: Command, whole: boolean): Outcome {
  reference.whole = whole;
  try {
    return { ok: true, score: createHistory().apply(source, command).score };
  } catch (error) {
    if (!(error instanceof CommandError)) throw error;
    return { ok: false, code: error.code };
  } finally {
    reference.whole = false;
  }
}

describe('windowed validation agrees with full validation', () => {
  it.each([11, 12, 13, 14])(
    'seed %i: each beat command is accepted or refused as the whole-track check would, and never raises a rule',
    { timeout: 60_000 },
    (seed) => {
      const next = random(seed);
      const int = (max: number): number => Math.floor(next() * max);
      const pick = <T>(items: readonly T[]): T => {
        const item = items[int(items.length)];
        if (item === undefined) throw new Error('empty pick');
        return item;
      };
      let current = seed % 2 === 0 ? seededViolations() : heldAcrossBars();
      const codes = new Map<string, number>();
      let applied = 0;
      for (let step = 0; step < 250; step++) {
        const located = current.tracks.flatMap((track, t) =>
          track.bars.flatMap((bar, b) =>
            bar.voices.flatMap((voice) =>
              voice.beats.map((beat, index) => ({ track, t, b, voice, beat, index })),
            ),
          ),
        );
        const voices = current.tracks.flatMap((track, t) =>
          track.bars.flatMap((bar) => bar.voices.map((voice) => ({ track, t, voice }))),
        );
        const target = pick(located);
        const v = pick(voices);
        const notes = located.flatMap((l) => l.beat.notes);
        const graces = located.flatMap((l) => l.beat.grace?.flatMap((g) => g.notes) ?? []);
        const fresh = () => createNote({ string: 1 + int(3), fret: int(8), tie: next() < 0.4 });
        // An id from the score, now and then, so reuse reaches the fresh-id checks.
        const idMaybeUsed = () =>
          next() < 0.3 ? pick([...notes, ...located.map((l) => l.beat)]).id : undefined;
        const graceList = () => {
          const old = graces.length > 0 && next() < 0.6 ? [pick(graces)] : [];
          const list = [...old, ...(next() < 0.7 ? [fresh()] : [])];
          if (list.length > 0 && next() < 0.3) list.push({ ...pick(list), string: 2 });
          return list.length === 0 ? null : [{ duration: 16 as const, before: true, notes: list }];
        };
        const other = pick(voices.filter((o) => o.voice.id !== v.voice.id).concat(v));
        const spliceOf = (
          w: typeof v,
        ): {
          voiceId: string;
          index: number;
          remove: number;
          beats: ReturnType<typeof createBeat>[];
        } => {
          const index = int(w.voice.beats.length + 1);
          return {
            voiceId: w.voice.id,
            index,
            remove: int(w.voice.beats.length - index + 1),
            beats: [createBeat({ duration: 4, notes: [fresh()] })],
          };
        };
        const commands: Command[] = [
          (() => {
            const id = idMaybeUsed();
            return insertBeat(
              { voiceId: v.voice.id, index: int(v.voice.beats.length + 1), ...(id ? { id } : {}) },
              {
                duration: pick([4, 8, 16, 2] as const),
                notes: next() < 0.6 ? [fresh()] : [],
              },
            );
          })(),
          removeBeat({ beatId: target.beat.id }),
          setBeatRest({ beatId: target.beat.id }, next() < 0.5),
          setBeatDuration(
            { beatId: target.beat.id },
            { duration: pick([2, 4, 8, 16] as const), dots: pick([0, 1] as const) },
          ),
          setBeatDurations(
            located
              .filter((l) => l.voice === target.voice)
              .map((l) => ({ beatId: l.beat.id, rhythm: { duration: pick([8, 16, 2] as const) } })),
          ),
          setNote(
            { beatId: target.beat.id },
            { string: 1 + int(3), fret: int(8), tie: next() < 0.5 },
          ),
          setBeatEffect({ beatId: target.beat.id }, { grace: graceList() }),
          setBeatEffects(
            [...new Set([target, pick(located), pick(located)].map((l) => l.beat.id))].map(
              (beatId) => ({ beatId, changes: { grace: graceList() } }),
            ),
          ),
          replaceBeats(
            other.voice.id === v.voice.id ? [spliceOf(v)] : [spliceOf(v), spliceOf(other)],
          ),
        ];
        const command = pick(commands);
        const windowed = outcomeOf(current, command, false);
        const whole = outcomeOf(current, command, true);
        expect(
          windowed.ok,
          `${command.name}: windowed ${JSON.stringify(windowed.ok ? 'ok' : windowed)} vs whole ${JSON.stringify(whole.ok ? 'ok' : whole)}`,
        ).toBe(whole.ok);
        if (!windowed.ok) {
          expect(windowed.code).toBe(whole.ok ? '' : whole.code);
          codes.set(windowed.code, (codes.get(windowed.code) ?? 0) + 1);
          continue;
        }
        const before = ruleCounts(current);
        for (const [rule, count] of ruleCounts(windowed.score)) {
          expect(count, `${command.name} raised ${rule}`).toBeLessThanOrEqual(
            before.get(rule) ?? 0,
          );
        }
        current = windowed.score;
        applied += 1;
      }
      expect(applied).toBeGreaterThan(20);
      expect(codes.get('invariant') ?? 0).toBeGreaterThan(0);
    },
  );
});
