/**
 * Where our reader and alphaTab legitimately disagree. A difference no entry accepts fails the
 * oracle, and an entry that accepts no difference in its formats fails too, so the list stays
 * as short as the corpus allows. Sources: the classified comparison in the review of PR #56,
 * the reader's mapping decisions in `packages/formats/README.md`, and alphaTab 1.8.4's
 * `Gp3To5Importer`, `GpifParser` and model `finish` methods (`node_modules/@coderline/alphatab/dist/alphaTab.core.mjs`).
 */
import type { Difference } from './compare';
import {
  isBareEmpty,
  type BeatProjection,
  type MixProjection,
  type ScoreProjection,
} from './projection';
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
/** The gpif reader is one code path for gp and gpx, so a decision of its own covers both. */
const WITH_GPIF: readonly FixtureFormat[] = [...GP3_TO_5, 'gp', 'gpx'];

/** Only the gpif reader is held to these: each was found on, and is proved by, a gpif document. */
const GPIF_ONLY: readonly FixtureFormat[] = ['gp', 'gpx'];

const BEAT_FIELD = /\.beats\[\d+\]\.(?<field>\w+)$/;
const NOTE_FIELD = /\.beats\[\d+\]\.notes\[\d+\]\.(?<field>\w+)$/;
const TRACK = /^tracks\[(?<track>\d+)\]/;
const BAR_VOICE_BEATS =
  /^tracks\[(?<track>\d+)\]\.bars\[(?<bar>\d+)\]\.voices\[(?<voice>\d+)\]\.beats$/;
const FIRST_VOICE_MIX =
  /^tracks\[(?<track>\d+)\]\.bars\[(?<bar>\d+)\]\.voices\[(?<voice>\d+)\]\.beats\[(?<beat>\d+)\]\.mix$/;
const TRACK_OCTAVE_SHIFT = /^tracks\[\d+\]\.octaveShift$/;
const MASTER_BAR_ENDINGS = /^masterBars\[(?<bar>\d+)\]\.alternateEndings$/;

const isBeatField = (difference: Difference, field: string): boolean =>
  BEAT_FIELD.exec(difference.path)?.groups?.['field'] === field;

const isNoteField = (difference: Difference, field: string): boolean =>
  NOTE_FIELD.exec(difference.path)?.groups?.['field'] === field;

const NOTE_DENOMINATORS: readonly number[] = [4, 8, 16, 32, 64, 128];

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

/** `Beat.finish`: one grace beat in the group is an eighth, two are sixteenths, more are 32nds. */
const alphaTabGraceDuration = (graces: number): number =>
  graces === 1 ? 8 : graces === 2 ? 16 : 32;

/** alphaTab's `_gp5PercussionInstrumentMap` entries that differ from the GM note. */
const ALPHATAB_PERCUSSION = new Map([
  [27, 42],
  [28, 60],
  [32, 31],
]);

/** The GP3 dip the reader writes: three points, down to the depth at mid-note and back. */
const GP3_DIP: Readonly<Record<string, (value: number) => boolean>> = {
  whammyPoints: (value) => value === 3,
  whammyFrom: (value) => value === 0,
  whammyTo: (value) => value === 0,
  whammyMax: (value) => value === 0,
  whammyMin: (value) => value < 0,
};

const MIX_FIELDS = ['program', 'volume', 'pan'] as const;

/** Every value `mix` sets is set to the same value in one of `holders`. */
const heldBy = (mix: MixProjection, holders: readonly (MixProjection | null)[]): boolean =>
  MIX_FIELDS.every(
    (field) => mix[field] === null || holders.some((holder) => holder?.[field] === mix[field]),
  );

const nearlyInteger = (value: number): boolean => Math.abs(value - Math.round(value)) < 1e-9;

export const TOLERANCES: readonly Tolerance[] = [
  {
    id: 'grace-duration',
    formats: WITH_GPIF,
    why: "We read the grace duration byte (1, 2, 3 as a 64th, 32nd, 16th), as TuxGuitar and PyGuitarPro do (lead ruling, PR #56); alphaTab's `readGrace` skips the byte and `Beat.finish` sets the duration from the grace group's size: an eighth for one grace beat, a sixteenth for two, a 32nd for more. In gpif the grace beat's own `Rhythm` is kept (`32nd` in effects.gpx); `GpifParser._buildModel` reads it too, and the same `Beat.finish` overrides it.",
    applies: (d) =>
      /\.graces\[\d+\]\.duration$/.test(d.path) &&
      d.beat !== undefined &&
      d.alphaTab === alphaTabGraceDuration(d.beat.alphaTab.graces.length),
  },
  {
    id: 'bend-points-kept',
    formats: WITH_GPIF,
    why: 'The model keeps each bend as the file stores it (score-model reference, "Bend and whammy points"); alphaTab\'s `Note.finish` rewrites a three- or four-point list to the shape of the bend type it detects: two points for a bend, release, prebend or hold (PR #56: `[0,0],[15,4],[60,4]` against `[0,0],[60,4]`), four for a three-point bend-release. The ends and `maxBendPoint` survive, so the values are still compared. gpif stores origin, middle and destination values, kept as three points; `GpifParser` builds the same three and `Note.finish` splices the duplicate middle point of a bend-release in (effects.gpx, bars[7]).',
    applies: (d) =>
      isNoteField(d, 'bendPoints') &&
      ((d.alphaTab === 2 && (d.ours === 3 || d.ours === 4)) || (d.alphaTab === 4 && d.ours === 3)),
  },
  {
    id: 'gp3-tremolo-bar',
    formats: ['gp3'],
    why: "GP3 stores a tremolo bar as one depth, which we read as a dip to that depth, the shape GP4 writes for the same effect (README, PyGuitarPro agrees); alphaTab's `readBeatEffects` skips the GP3 depth int, so it has no whammy at all.",
    applies: (d) => {
      const field = BEAT_FIELD.exec(d.path)?.groups?.['field'];
      const expected = field === undefined ? undefined : GP3_DIP[field];
      return (
        expected !== undefined &&
        d.alphaTab === null &&
        typeof d.ours === 'number' &&
        expected(d.ours)
      );
    },
  },
  {
    id: 'beat-vibrato-wide',
    formats: GP3_TO_5,
    why: 'Beat-effect bit 0x02 is Guitar Pro\'s beat-level wide vibrato (README, "Vibrato"); alphaTab\'s `readBeatEffects` reads it as slight.',
    applies: (d) => isBeatField(d, 'vibrato') && d.ours === 'wide' && d.alphaTab === 'slight',
  },
  {
    id: 'gp3-beat-vibrato-on-notes',
    formats: ['gp3'],
    why: "GP3 has no note-level vibrato flag and stores a note's slight vibrato as beat-effect bit 0x01, so we put it on the beat's notes (README, \"Vibrato\"); alphaTab's `readBeatEffects` leaves it on the beat.",
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
    why: "We read the stroke speed byte 1 to 6 as a 128th down to a quarter, as Guitar Pro's dialog, TuxGuitar and PyGuitarPro do; alphaTab's `_toStrokeValue` is one step slower (1 and 2 both 30 ticks, a 128th), so speeds 2 to 6 read at half our note value (PR #56).",
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
    id: 'stroke-length-rounded',
    formats: GPIF_ONLY,
    why: 'A stroke length (`XProperty` 687935489) that is not an exact note value is read as the nearest note value on a log scale, because `Stroke.duration` holds only 4 to 128 (README, "Stroke length"); alphaTab keeps the exact tick count, so its denominator (3840 / ticks) is not a note value, or is one outside 4 to 128 (15, 1920 or 3840 ticks), which ours clamps.',
    applies: (d) => {
      const [ours, theirs] = [stroke(d.ours), stroke(d.alphaTab)];
      return (
        (isBeatField(d, 'brush') || isBeatField(d, 'arpeggio')) &&
        ours !== undefined &&
        theirs !== undefined &&
        ours.direction === theirs.direction &&
        !NOTE_DENOMINATORS.includes(theirs.duration) &&
        ours.duration === 2 ** Math.min(7, Math.max(2, Math.round(Math.log2(theirs.duration))))
      );
    },
  },
  {
    id: 'percussion-articulations',
    formats: GP3_TO_5,
    why: "A drum note keeps its GM note, and the model's percussion table has 27, 28 and 32 as GM2's High Q, Slap and Square Click; alphaTab's `readNote` maps those three through `_gp5PercussionInstrumentMap` to its own articulation indices (PR #56: an articulation quirk, not a MIDI remap).",
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
    formats: WITH_GPIF,
    why: 'The model puts the volta numbers on every bar of the bracket, through the bar that closes the repeat (score-model reference, "Volta numbers"); alphaTab\'s `readMasterBar` marks the bracket\'s first bar only. The gpif reader copies the numbers the same way (README, "Volta brackets"); `GpifParser._parseMasterBar` reads `AlternateEndings` on that bar alone.',
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
  {
    id: 'whammy-points-kept',
    formats: GPIF_ONLY,
    why: "The model keeps the whammy curve as the file stores it, four points in gpif; alphaTab's `Beat.finish` removes both middle points of a monotonic curve whose two middle values are equal, and one of a dip whose middle points share an offset. A flat curve (all three values equal) also goes from four points to two. The ends, highest and lowest value survive, so they are still compared; a dropped middle point is not, so the reader's own tests are its only guard. The whammy twin of `bend-points-kept`.",
    applies: (d) => {
      const { beat } = d;
      return (
        isBeatField(d, 'whammyPoints') &&
        beat !== undefined &&
        d.ours === 4 &&
        (d.alphaTab === 2 || d.alphaTab === 3) &&
        beat.ours.whammyFrom === beat.alphaTab.whammyFrom &&
        beat.ours.whammyTo === beat.alphaTab.whammyTo &&
        beat.ours.whammyMax === beat.alphaTab.whammyMax &&
        beat.ours.whammyMin === beat.alphaTab.whammyMin
      );
    },
  },
  {
    id: 'chromatic-transposition',
    formats: GPIF_ONLY,
    why: '`Track/Transpose/Chromatic` is not modelled (model README, formats README "Not read"), so our octave shift is the file\'s `Octave` alone; alphaTab\'s `displayTranspositionPitch` adds the chromatic part, so its shift is ours plus 1 to 11 semitones over 12, either way. The projection does not carry the file\'s `Chromatic`, so that bound stands in for "alphaTab\'s shift minus ours equals the chromatic part over 12"; an octave or more is never accepted, since it could be a wrong `Octave`.',
    applies: (d) => {
      if (!TRACK_OCTAVE_SHIFT.test(d.path)) return false;
      if (typeof d.ours !== 'number' || typeof d.alphaTab !== 'number') return false;
      const semitones = (d.alphaTab - d.ours) * 12;
      const whole = Math.round(semitones);
      return nearlyInteger(semitones) && whole !== 0 && Math.abs(whole) < 12;
    },
  },
  {
    id: 'track-automation-on-first-beat',
    formats: GPIF_ONLY,
    why: "We place a track automation (a sound change) on the beat at its `Position`; alphaTab's `GpifParser._buildModel` pushes every one onto `voices[0].beats[0]` of its bar and ignores the position, so the oracle cannot check where we place it (the unit of `Position` is #153's open question). Accepted where the two sides hold the same values and differ only in which beat holds the change: a later beat of voice 0, or, when our voice 0 is empty, a beat of another voice of the bar.",
    applies: (d, { ours, alphaTab }) => {
      const at = FIRST_VOICE_MIX.exec(d.path)?.groups;
      if (at === undefined) return false;
      const [track, bar, voice, index] = [
        Number(at['track']),
        Number(at['bar']),
        Number(at['voice']),
        Number(at['beat']),
      ];
      const ourVoices = ours.tracks[track]?.bars[bar]?.voices ?? [];
      const ourBeats = ourVoices[voice]?.beats ?? [];
      const theirMix = alphaTab.tracks[track]?.bars[bar]?.voices[0]?.beats[0]?.mix ?? null;
      if (voice === 0 && index === 0) {
        return (
          d.ours === null &&
          theirMix !== null &&
          heldBy(
            theirMix,
            ourBeats.slice(1).map((beat) => beat.mix),
          )
        );
      }
      const mix = ourBeats[index]?.mix ?? null;
      return (
        (voice === 0 || ourVoices[0]?.beats.length === 0) &&
        d.alphaTab === null &&
        mix !== null &&
        theirMix !== null &&
        heldBy(mix, [theirMix])
      );
    },
  },
  {
    id: 'placeholder-beat-holds-automation',
    formats: GPIF_ONLY,
    why: "For every `-1` voice in a bar alphaTab's `_buildModel` adds a voice holding one empty quarter beat; the projection drops those, except that the track automation `_buildModel` pushes onto `voices[0].beats[0]` lands on it and keeps it. Accepted only when one of our beats in the same bar holds that change. A change we drop (a sound change in a bar with no beats, `automation-dropped`) is a reader bug, #153, and stays reported.",
    applies: (d, { ours, alphaTab }) => {
      const at = BAR_VOICE_BEATS.exec(d.path)?.groups;
      if (at === undefined) return false;
      const [track, bar, voice] = [Number(at['track']), Number(at['bar']), Number(at['voice'])];
      const theirs = alphaTab.tracks[track]?.bars[bar]?.voices[voice]?.beats;
      const ourVoices = ours.tracks[track]?.bars[bar]?.voices ?? [];
      const [placeholder] = theirs ?? [];
      return (
        ourVoices[voice]?.beats.length === 0 &&
        theirs?.length === 1 &&
        placeholder !== undefined &&
        placeholder.mix !== null &&
        placeholder.duration === 4 &&
        placeholder.dots === 0 &&
        placeholder.tuplet === null &&
        isBareEmpty({ ...placeholder, mix: null }) &&
        heldBy(
          placeholder.mix,
          ourVoices.flatMap((v) => v.beats.map((beat) => beat.mix)),
        )
      );
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
