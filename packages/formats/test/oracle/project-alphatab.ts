import * as alphaTab from '@coderline/alphatab';
import type { TrackKind } from '@reprise/model';

import {
  ACCENTS,
  DYNAMICS,
  VIBRATO,
  keyName,
  strokeName,
  trimVoices,
  tupletName,
  type BeatProjection,
  type GraceProjection,
  type MasterBarProjection,
  type NoteProjection,
  type ScoreProjection,
  type TrackProjection,
} from './projection';

const { BrushType, GraceType, HarmonicType, KeySignatureType, SlideInType, SlideOutType } =
  alphaTab.model;

type AtNote = alphaTab.model.Note;
type AtBeat = alphaTab.model.Beat;
type AtTrack = alphaTab.model.Track;
type AtMasterBar = alphaTab.model.MasterBar;

const HARMONICS = new Map<number, string>([
  [HarmonicType.Natural, 'natural'],
  [HarmonicType.Artificial, 'artificial'],
  [HarmonicType.Pinch, 'pinch'],
  [HarmonicType.Tap, 'tapped'],
  [HarmonicType.Semi, 'semi'],
  [HarmonicType.Feedback, 'feedback'],
]);

const SLIDES_IN = new Map<number, string>([
  [SlideInType.IntoFromBelow, 'intoFromBelow'],
  [SlideInType.IntoFromAbove, 'intoFromAbove'],
]);

const SLIDES_OUT = new Map<number, string>([
  [SlideOutType.Shift, 'shift'],
  [SlideOutType.Legato, 'legato'],
  [SlideOutType.OutUp, 'outUp'],
  [SlideOutType.OutDown, 'outDown'],
  [SlideOutType.PickSlideDown, 'pickSlideDown'],
  [SlideOutType.PickSlideUp, 'pickSlideUp'],
]);

/** alphaTab spells durations in ticks where the model spells note values. */
const QUARTER_TICKS = 960;

const named = (names: readonly string[], index: number): string =>
  names[index] ?? `unknown ${String(index)}`;

function settings(): alphaTab.Settings {
  const result = new alphaTab.Settings();
  result.core.logLevel = alphaTab.LogLevel.None;
  return result;
}

export function loadWithAlphaTab(bytes: Uint8Array): alphaTab.model.Score {
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings());
}

function projectNote(note: AtNote, kind: TrackKind): NoteProjection {
  const tuning = note.beat.voice.bar.staff.tuning;
  const slides = [SLIDES_IN.get(note.slideInType), SLIDES_OUT.get(note.slideOutType)];
  let string = 0;
  let value = note.fret;
  if (note.isPercussion) value = note.percussionArticulation;
  else if (kind === 'pitched') value = note.fret + note.stringTuning;
  else string = tuning.length - note.string + 1;
  return {
    string,
    value,
    tie: note.isTieDestination,
    dead: note.isDead,
    ghost: note.isGhost,
    hammerPull: note.isHammerPullDestination,
    slides: slides.filter((slide) => slide !== undefined).sort(),
    bendPoints: note.hasBend ? (note.bendPoints?.length ?? 0) : null,
    harmonic: HARMONICS.get(note.harmonicType) ?? null,
    palmMute: note.isPalmMute,
    letRing: note.isLetRing,
    vibrato: named(VIBRATO, note.vibrato),
    trill: note.isTrill ? [note.trillFret, note.trillSpeed] : null,
    staccato: note.isStaccato,
    accent: named(ACCENTS, note.accentuated),
    dynamics: named(DYNAMICS, note.dynamics),
  };
}

function chordOf(beat: AtBeat): BeatProjection['chord'] {
  const chord = beat.chord;
  if (chord === null) return null;
  const frets = chord.strings.map((fret) => (fret < 0 ? null : fret));
  return { name: chord.name, frets: frets.some((fret) => fret !== null) ? frets : null };
}

/** alphaTab keeps the file's mark count: one mark an eighth, two a sixteenth, three a 32nd. */
function tremoloOf(beat: AtBeat): number | null {
  const marks = beat.tremoloPicking?.marks ?? 0;
  return marks > 0 ? 4 * 2 ** marks : null;
}

function brushOf(beat: AtBeat): string | null {
  if (beat.brushType === BrushType.None) return null;
  const direction = beat.brushType === BrushType.BrushUp ? 'up' : 'down';
  const duration = beat.brushDuration > 0 ? (4 * QUARTER_TICKS) / beat.brushDuration : undefined;
  return strokeName(direction, duration);
}

function projectBeat(beat: AtBeat, kind: TrackKind, graces: GraceProjection[]): BeatProjection {
  return {
    duration: beat.duration,
    dots: beat.dots,
    tuplet: tupletName(beat.tupletNumerator, beat.tupletDenominator),
    // alphaTab's `isRest` is also true for Guitar Pro's empty beat, which `isEmpty` marks.
    rest: !beat.isEmpty && beat.notes.length === 0,
    graces,
    text: beat.text,
    chord: chordOf(beat),
    tremoloPicking: tremoloOf(beat),
    vibrato: named(VIBRATO, beat.vibrato),
    whammyPoints: beat.hasWhammyBar ? (beat.whammyBarPoints?.length ?? 0) : null,
    brush: brushOf(beat),
    lyrics: beat.lyrics ? [...beat.lyrics] : null,
    notes: beat.notes.map((note) => projectNote(note, kind)),
  };
}

/** alphaTab keeps grace notes as beats of their own ahead of the main beat; the model nests
 * them in it. */
function projectBeats(beats: AtBeat[], kind: TrackKind): BeatProjection[] {
  const result: BeatProjection[] = [];
  let pending: AtBeat[] = [];
  for (const beat of beats) {
    if (beat.graceType !== GraceType.None) {
      pending.push(beat);
      continue;
    }
    const graces = pending.map((grace) => ({
      duration: grace.duration,
      before: grace.graceType !== GraceType.OnBeat,
      notes: grace.notes.map((note) => projectNote(note, kind)),
    }));
    result.push(projectBeat(beat, kind, graces));
    pending = [];
  }
  // A grace with no main beat after it has nothing to nest in; it shows up as a beat of its own.
  for (const grace of pending) result.push(projectBeat(grace, kind, []));
  return result;
}

function projectTrack(track: AtTrack, kind: TrackKind): TrackProjection {
  const staff = track.staves[0];
  const tuning = [...(staff?.tuning ?? [])].reverse();
  return {
    name: track.name,
    strings: tuning.length,
    tuning,
    capo: staff?.capo ?? 0,
    percussion: staff?.isPercussion ?? false,
    bars: (staff?.bars ?? []).map((bar) => ({
      voices: trimVoices(bar.voices.map((voice) => ({ beats: projectBeats(voice.beats, kind) }))),
    })),
  };
}

function alternateEndings(mask: number): number[] {
  const numbers: number[] = [];
  for (let bit = 0; bit < 8; bit += 1) if ((mask & (1 << bit)) !== 0) numbers.push(bit + 1);
  return numbers;
}

function barTempos(masterBar: AtMasterBar, opening: number | null): number[] {
  const tempos = opening === null ? [] : [opening];
  const automations = [...masterBar.tempoAutomations].sort(
    (a, b) => a.ratioPosition - b.ratioPosition,
  );
  for (const { value } of automations) if (tempos.at(-1) !== value) tempos.push(value);
  return tempos;
}

function projectMasterBar(masterBar: AtMasterBar, opening: number | null): MasterBarProjection {
  // alphaTab copies the master bar's key onto every staff's bar and deprecates the master bar's.
  const bar = masterBar.score.tracks[0]?.staves[0]?.bars[masterBar.index];
  return {
    timeSignature: `${String(masterBar.timeSignatureNumerator)}/${String(masterBar.timeSignatureDenominator)}`,
    key: bar ? keyName(bar.keySignature, bar.keySignatureType === KeySignatureType.Minor) : 'none',
    repeatStart: masterBar.isRepeatStart,
    repeatEnd: masterBar.repeatCount,
    alternateEndings: alternateEndings(masterBar.alternateEndings),
    tempos: barTempos(masterBar, opening),
    section: masterBar.section?.text ?? null,
  };
}

/**
 * `kinds` are the model's track kinds, by track index. alphaTab has no pitched track kind for
 * Guitar Pro 3 to 5 files, so it says only how a note's value is spelled, never what is compared.
 */
export function projectAlphaTab(
  score: alphaTab.model.Score,
  kinds: readonly TrackKind[],
): ScoreProjection {
  return {
    tracks: score.tracks.map((track, index) => projectTrack(track, kinds[index] ?? 'fretted')),
    masterBars: score.masterBars.map((masterBar, index) =>
      projectMasterBar(masterBar, index === 0 ? score.tempo : null),
    ),
  };
}
