/**
 * Where our reader and alphaTab legitimately disagree. A difference no entry accepts fails the
 * oracle, and an entry that accepts no difference in its formats fails too, so the list stays
 * as short as the corpus allows. Sources: the classified comparison in the review of PR #56,
 * the reader's mapping decisions in `packages/formats/README.md`, and alphaTab 1.8.4's
 * `Gp3To5Importer` (`node_modules/@coderline/alphatab/dist/alphaTab.core.mjs`).
 */
import type { Difference } from './compare';
import type { BeatProjection, ScoreProjection } from './projection';
import type { FixtureFormat } from './readers';

export interface Projections {
  ours: ScoreProjection;
  alphaTab: ScoreProjection;
}

export interface Tolerance {
  id: string;
  formats: readonly FixtureFormat[];
  /** One or two sentences, naming the source. */
  why: string;
  applies: (difference: Difference, projections: Projections) => boolean;
}

const GP3_TO_5: readonly FixtureFormat[] = ['gp3', 'gp4', 'gp5'];

const BEAT_FIELD = /\.beats\[\d+\]\.(?<field>\w+)$/;
const NOTE_FIELD = /\.beats\[\d+\]\.notes\[\d+\]\.(?<field>\w+)$/;
const TRACK = /^tracks\[(?<track>\d+)\]/;
const MASTER_BAR_ENDINGS = /^masterBars\[(?<bar>\d+)\]\.alternateEndings$/;

const isBeatField = (difference: Difference, field: string): boolean =>
  BEAT_FIELD.exec(difference.path)?.groups?.['field'] === field;

const isNoteField = (difference: Difference, field: string): boolean =>
  NOTE_FIELD.exec(difference.path)?.groups?.['field'] === field;

const stroke = (value: unknown): { direction: string; duration: number } | undefined => {
  if (typeof value !== 'string') return undefined;
  const [direction, duration] = value.split(' ');
  return direction === undefined || duration === undefined
    ? undefined
    : { direction, duration: Number(duration) };
};

const sameNumbers = (a: readonly number[] | undefined, b: readonly number[]): boolean =>
  a !== undefined && a.length === b.length && a.every((value, i) => value === b[i]);

const everyNote = (beat: BeatProjection | undefined, vibrato: string): boolean =>
  beat !== undefined &&
  beat.notes.length > 0 &&
  beat.notes.every((note) => note.vibrato === vibrato);

/** alphaTab's `_gp5PercussionInstrumentMap` entries that differ from the GM note. */
const ALPHATAB_PERCUSSION = new Map([
  [27, 42],
  [28, 60],
  [32, 31],
]);

export const TOLERANCES: readonly Tolerance[] = [
  {
    id: 'grace-duration',
    formats: GP3_TO_5,
    why: "We read the grace duration byte (1, 2, 3 as a 64th, 32nd, 16th), as TuxGuitar and PyGuitarPro do (lead ruling, PR #56); alphaTab's `readGrace` ignores it and a lone grace beat's `finish` writes an eighth.",
    applies: (d) => /\.graces\[\d+\]\.duration$/.test(d.path) && d.alphaTab === 8,
  },
  {
    id: 'bend-points-kept',
    formats: GP3_TO_5,
    why: 'The model keeps each bend as the file stores it (score-model reference, "Bend and whammy points"); alphaTab drops points it finds redundant, so it holds fewer (PR #56: `[0,0],[15,4],[60,4]` against `[0,0],[60,4]`).',
    applies: (d) =>
      isNoteField(d, 'bendPoints') &&
      typeof d.ours === 'number' &&
      typeof d.alphaTab === 'number' &&
      d.alphaTab >= 2 &&
      d.alphaTab < d.ours,
  },
  {
    id: 'gp3-tremolo-bar',
    formats: ['gp3'],
    why: "GP3 stores a tremolo bar as one depth, which we read as a dip to that depth, the shape GP4 writes for the same effect (README, PyGuitarPro agrees); alphaTab's GP3 path skips it.",
    applies: (d) =>
      isBeatField(d, 'whammyPoints') && typeof d.ours === 'number' && d.alphaTab === null,
  },
  {
    id: 'beat-vibrato-wide',
    formats: GP3_TO_5,
    why: 'Beat-effect bit 0x02 is Guitar Pro\'s beat-level wide vibrato (README, "Vibrato"); alphaTab reads it as slight.',
    applies: (d) => isBeatField(d, 'vibrato') && d.ours === 'wide' && d.alphaTab === 'slight',
  },
  {
    id: 'gp3-beat-vibrato-on-notes',
    formats: ['gp3'],
    why: 'GP3 has no note-level vibrato flag and stores a note\'s slight vibrato as beat-effect bit 0x01, so we put it on the beat\'s notes (README, "Vibrato"); alphaTab leaves it on the beat.',
    applies: (d) =>
      (isBeatField(d, 'vibrato') &&
        d.ours === 'none' &&
        d.alphaTab === 'slight' &&
        everyNote(d.beat?.ours, 'slight')) ||
      (isNoteField(d, 'vibrato') &&
        d.ours === 'slight' &&
        d.alphaTab === 'none' &&
        d.beat?.alphaTab.vibrato === 'slight'),
  },
  {
    id: 'stroke-speed',
    formats: GP3_TO_5,
    why: "We read the stroke speed byte 1 to 6 as a 128th down to a quarter, as Guitar Pro's dialog, TuxGuitar and PyGuitarPro do; alphaTab's `_toStrokeValue` is one step slower (1 and 2 both a 128th), so speeds 2 to 6 read at half our note value (PR #56).",
    applies: (d) => {
      const [ours, theirs] = [stroke(d.ours), stroke(d.alphaTab)];
      return (
        isBeatField(d, 'brush') &&
        ours !== undefined &&
        theirs !== undefined &&
        ours.direction === theirs.direction &&
        theirs.duration === ours.duration * 2
      );
    },
  },
  {
    id: 'percussion-articulations',
    formats: GP3_TO_5,
    why: "A drum note keeps its GM note, and the model's percussion table has 27, 28 and 32 as GM2's High Q, Slap and Square Click; alphaTab maps those three to its own articulation indices (PR #56: an articulation quirk, not a MIDI remap).",
    applies: (d, { ours }) => {
      const track = Number(TRACK.exec(d.path)?.groups?.['track']);
      return (
        isNoteField(d, 'value') &&
        ours.tracks[track]?.percussion === true &&
        typeof d.ours === 'number' &&
        ALPHATAB_PERCUSSION.get(d.ours) === d.alphaTab
      );
    },
  },
  {
    id: 'voltas-on-every-bar',
    formats: GP3_TO_5,
    why: 'The model puts the volta numbers on every bar of the bracket, through the bar that closes the repeat (score-model reference, "Volta numbers"); alphaTab marks the bracket\'s first bar only.',
    applies: (d, { ours, alphaTab }) => {
      const bar = Number(MASTER_BAR_ENDINGS.exec(d.path)?.groups?.['bar']);
      const numbers = ours.masterBars[bar]?.alternateEndings;
      if (Number.isNaN(bar) || numbers === undefined || numbers.length === 0) return false;
      if (alphaTab.masterBars[bar]?.alternateEndings.length !== 0) return false;
      for (let first = bar - 1; first >= 0; first -= 1) {
        if (!sameNumbers(ours.masterBars[first]?.alternateEndings, numbers)) return false;
        const theirs = alphaTab.masterBars[first]?.alternateEndings ?? [];
        if (theirs.length > 0) return sameNumbers(theirs, numbers);
      }
      return false;
    },
  },
];

export function toleranceFor(
  difference: Difference,
  format: FixtureFormat,
  projections: Projections,
): Tolerance | undefined {
  return TOLERANCES.find(
    (tolerance) => tolerance.formats.includes(format) && tolerance.applies(difference, projections),
  );
}
