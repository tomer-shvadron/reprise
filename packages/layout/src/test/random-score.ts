import type { Beat, BeatEffects, Dynamics, Note, Score } from '@reprise/model';
import { midi, note, score, type DurationSpec } from '@reprise/model/testing';

/** mulberry32: a seeded generator, so a failing seed rebuilds the same score. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DYNAMICS: readonly Dynamics[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];
const DRUMS = [35, 36, 38, 40, 42, 44, 46, 49, 51, 57];
const BENDS: readonly NonNullable<Note['bend']>[] = [
  {
    kind: 'bend',
    points: [
      { position: 0, value: 0 },
      { position: 60, value: 4 },
    ],
  },
  {
    kind: 'bendRelease',
    points: [
      { position: 0, value: 0 },
      { position: 20, value: 4 },
      { position: 40, value: 4 },
      { position: 60, value: 0 },
    ],
  },
  {
    kind: 'prebend',
    points: [
      { position: 0, value: 4 },
      { position: 60, value: 4 },
    ],
  },
];

/**
 * A valid one-track score built from `seed`: a guitar, bass, drum or piano track of 4 to 9 bars
 * in one to three voices, every quarter filled with one rhythm figure (plain values down to 64ths,
 * lone flagged notes between rests, triplets, quintuplets, sextuplets, septuplets, graces),
 * chords of up to four notes with ties, hammer-ons, slides, articulations, harmonics, fingering,
 * bends and lane effects, clef and key changes, and dynamics, lyrics and chord names in half the
 * scores: the other half write no dynamic, so nothing hides what reaches below the staff.
 */
export function randomScore(seed: number): Score {
  const random = generator(seed);
  const chance = (p: number): boolean => random() < p;
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  };
  const builder = score();
  const plain = chance(0.5);
  const dynamics = (): Dynamics => (plain ? 'f' : pick(DYNAMICS));
  if (chance(0.3)) builder.key(pick([-6, -3, 2, 5, 7]));
  const kind = pick(['guitar', 'guitar', 'guitar', 'bass', 'drums', 'piano'] as const);
  builder.track(kind);
  const fretted = kind === 'guitar' || kind === 'bass';
  const strings = kind === 'bass' ? 4 : 6;

  const fretNote = (): Note =>
    note(1 + Math.floor(random() * strings), Math.floor(random() * 25), {
      dynamics: dynamics(),
      ...(chance(0.15) && { hammerPull: true }),
      ...(chance(0.1) && { staccato: true }),
      ...(chance(0.1) && { accent: pick(['accent', 'heavy'] as const) }),
      ...(chance(0.08) && {
        slide: [
          pick(['legato', 'shift', 'outDown', 'outUp', 'intoFromBelow', 'intoFromAbove'] as const),
        ],
      }),
      ...(chance(0.06) && { ghost: true }),
      ...(chance(0.04) && { dead: true }),
      ...(chance(0.05) && {
        harmonic: pick([
          { kind: 'natural' as const },
          { kind: 'artificial' as const, value: 12 },
          { kind: 'pinch' as const, value: 7 },
        ]),
      }),
      ...(chance(0.05) && {
        leftHandFinger: pick(['thumb', 'index', 'middle', 'ring', 'little'] as const),
      }),
      ...(chance(0.05) && { rightHandFinger: pick(['index', 'middle', 'ring'] as const) }),
      ...(chance(0.04) && { bend: pick(BENDS) }),
      ...(chance(0.04) && { vibrato: pick(['slight', 'wide'] as const) }),
      ...(chance(0.05) && { palmMute: true }),
      ...(chance(0.05) && { letRing: true }),
      ...(chance(0.03) && { trill: { fret: 3, speed: 16 as const } }),
    });
  const otherNote = (): Note =>
    kind === 'drums'
      ? midi(pick(DRUMS), {
          dynamics: dynamics(),
          ...(chance(0.2) && { ghost: true }),
          ...(chance(0.2) && { accent: 'accent' as const }),
          ...(chance(0.1) && { staccato: true }),
        })
      : midi(21 + Math.floor(random() * 88), {
          dynamics: dynamics(),
          ...(chance(0.1) && { staccato: true }),
          ...(chance(0.1) && { accent: pick(['accent', 'heavy'] as const) }),
        });

  let previous: Note[] = [];
  const chord = (): Note[] => {
    const notes: Note[] = [];
    const used = new Set<number>();
    const key = (n: Note): number => (fretted ? n.string : n.fret);
    if (kind !== 'drums' && previous.length > 0 && chance(0.1)) {
      const from = pick(previous);
      notes.push(
        fretted ? note(from.string, from.fret, { tie: true }) : midi(from.fret, { tie: true }),
      );
      used.add(key(from));
    }
    const count = 1 + Math.floor(random() * (kind === 'drums' ? 2 : 4));
    for (let i = 0; i < count; i++) {
      const made = fretted ? fretNote() : otherNote();
      if (used.has(key(made))) continue;
      used.add(key(made));
      notes.push(made);
    }
    previous = notes;
    return notes;
  };
  const extras = (): Partial<Beat> => {
    const effects: BeatEffects = {
      ...(chance(0.04) && { tremoloPicking: pick([8, 16, 32] as const) }),
      ...(chance(0.04) && { arpeggio: { direction: pick(['up', 'down'] as const) } }),
      ...(chance(0.03) && { brush: { direction: pick(['up', 'down'] as const) } }),
      ...(chance(0.03) && { pickStroke: pick(['up', 'down'] as const) }),
      ...(chance(0.02) && { fadeIn: true }),
      ...(chance(0.02) && { tapping: true }),
    };
    return {
      effects,
      ...(chance(0.04) && { text: 'txt' }),
      ...(!plain && chance(0.05) && { lyrics: ['la', chance(0.5) ? 'lo' : ''] }),
      ...(!plain && chance(0.03) && { chord: { name: pick(['Am', 'C#m7b5', 'G']) } }),
    };
  };
  const beat = (duration: DurationSpec, spec: Partial<Beat> = {}, rest = chance(0.12)): void => {
    if (rest) {
      builder.rest(duration, spec);
      previous = [];
    } else builder.beat(duration, chord(), { ...extras(), ...spec });
  };
  const run = (count: number, duration: DurationSpec, spec: Partial<Beat> = {}): void => {
    for (let i = 0; i < count; i++) beat(duration, spec);
  };
  const graceNote = (fret: number): Note => (fretted ? note(3, fret) : midi(60 + fret));

  const bars = 4 + Math.floor(random() * 6);
  for (let bar = 0; bar < bars; bar++) {
    builder.bar(
      kind !== 'drums' && chance(0.08)
        ? { clef: pick(['treble', 'bass', 'alto', 'tenor'] as const) }
        : {},
    );
    const voices = chance(0.1) ? 3 : chance(0.35) ? 2 : 1;
    for (let voice = 0; voice < voices; voice++) {
      builder.voice(voice === 0 ? 0 : voice === 1 ? 1 : 2);
      previous = [];
      if (chance(0.08)) {
        beat('1');
        continue;
      }
      if (chance(0.06)) {
        run(2, '2');
        continue;
      }
      for (let quarter = 0; quarter < 4; quarter++) {
        const figure = random();
        if (figure < 0.18) beat('4');
        else if (figure < 0.3) run(2, '8');
        else if (figure < 0.38) run(4, '16');
        else if (figure < 0.44) run(8, '32');
        else if (figure < 0.47) run(16, '64');
        else if (figure < 0.55) run(3, '8', { tuplet: { n: 3, of: 2 } });
        else if (figure < 0.61) run(5, '16', { tuplet: { n: 5, of: 4 } });
        else if (figure < 0.65) run(6, '16', { tuplet: { n: 6, of: 4 } });
        else if (figure < 0.69) run(7, '32', { tuplet: { n: 7, of: 8 } });
        else if (figure < 0.73) {
          beat('16');
          run(2, '32');
          beat('8');
        } else if (figure < 0.77) {
          beat('16.', {}, true);
          beat('32');
          beat('8', {}, true);
        } else if (figure < 0.8) {
          beat('16..', {}, true);
          beat('64');
          beat('8', {}, true);
        } else if (figure < 0.83) {
          beat('8.');
          beat('16');
        } else if (figure < 0.86) {
          run(3, '16', { tuplet: { n: 3, of: 2 } });
          beat('8');
        } else if (figure < 0.9) {
          const legato = fretted && chance(0.5);
          beat('8', {
            grace: [
              {
                duration: 16,
                before: true,
                notes: [legato ? note(3, 5, { slide: ['legato'] }) : graceNote(5)],
              },
            ],
          });
          beat('8');
        } else if (figure < 0.93) {
          beat('8', {
            grace: [
              { duration: 32, before: true, notes: [graceNote(7)] },
              { duration: 32, before: true, notes: [graceNote(8)] },
            ],
          });
          beat('8');
        } else if (figure < 0.96 && quarter < 3) {
          run(3, '4', { tuplet: { n: 3, of: 2 } });
          quarter += 1;
        } else beat('4');
      }
    }
  }
  return builder.build();
}
