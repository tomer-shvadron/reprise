import * as alphaTab from '@coderline/alphatab';
import type { TrackKind } from '@reprise/model';

import {
  ACCENTS,
  CLEFS,
  DYNAMICS,
  FINGERS,
  TRIPLET_FEELS,
  VIBRATO,
  keyName,
  normaliseMix,
  normaliseVoices,
  strokeName,
  tupletName,
  type BeatProjection,
  type ChordProjection,
  type GraceProjection,
  type MasterBarProjection,
  type MixProjection,
  type NoteProjection,
  type ScoreProjection,
  type TrackProjection,
} from './projection';

const {
  AutomationType,
  BarLineStyle,
  BrushType,
  Direction,
  FadeType,
  GraceType,
  HarmonicType,
  KeySignatureType,
  PickStroke,
  SlideInType,
  SlideOutType,
} = alphaTab.model;

type AtNote = alphaTab.model.Note;
type AtBeat = alphaTab.model.Beat;
type AtBar = alphaTab.model.Bar;
type AtTrack = alphaTab.model.Track;
type AtMasterBar = alphaTab.model.MasterBar;
type AtBendPoint = alphaTab.model.BendPoint;

// `Settings.core.logLevel` reaches the static `Logger` only through the API and player classes,
// never through `ScoreLoader`, so an importer warning would print into the test output.
alphaTab.Logger.logLevel = alphaTab.LogLevel.None;

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

const FADES = new Map<number, string>([
  [FadeType.FadeIn, 'in'],
  [FadeType.FadeOut, 'out'],
  [FadeType.VolumeSwell, 'swell'],
]);

const PICK_STROKES = new Map<number, string>([
  [PickStroke.Up, 'up'],
  [PickStroke.Down, 'down'],
]);

const DIRECTIONS = new Map<number, string>([
  [Direction.TargetFine, 'fine'],
  [Direction.TargetSegno, 'segno'],
  [Direction.TargetSegnoSegno, 'segnoSegno'],
  [Direction.TargetCoda, 'coda'],
  [Direction.TargetDoubleCoda, 'doubleCoda'],
  [Direction.JumpDaCapo, 'daCapo'],
  [Direction.JumpDaCapoAlCoda, 'dcAlCoda'],
  [Direction.JumpDaCapoAlDoubleCoda, 'dcAlDoubleCoda'],
  [Direction.JumpDaCapoAlFine, 'dcAlFine'],
  [Direction.JumpDalSegno, 'dalSegno'],
  [Direction.JumpDalSegnoAlCoda, 'dsAlCoda'],
  [Direction.JumpDalSegnoAlDoubleCoda, 'dsAlDoubleCoda'],
  [Direction.JumpDalSegnoAlFine, 'dsAlFine'],
  [Direction.JumpDalSegnoSegno, 'dalSegnoSegno'],
  [Direction.JumpDalSegnoSegnoAlCoda, 'dssAlCoda'],
  [Direction.JumpDalSegnoSegnoAlDoubleCoda, 'dssAlDoubleCoda'],
  [Direction.JumpDalSegnoSegnoAlFine, 'dssAlFine'],
  [Direction.JumpDaCoda, 'toCoda'],
  [Direction.JumpDaDoubleCoda, 'toDoubleCoda'],
]);

/** alphaTab spells durations in ticks where the model spells note values. */
const QUARTER_TICKS = 960;

const named = (names: readonly string[], index: number): string =>
  names[index] ?? `unknown ${String(index)}`;

const finger = (value: number): string | null => (value < 0 ? null : named(FINGERS, value));

const values = (points: readonly AtBendPoint[] | null): number[] | null =>
  points === null ? null : points.map((point) => point.value);

/** `encoding` overrides alphaTab's UTF-8 default for the strings of the file. */
export function loadWithAlphaTab(
  bytes: Uint8Array,
  options: { encoding?: string } = {},
): alphaTab.model.Score {
  const settings = new alphaTab.Settings();
  if (options.encoding !== undefined) settings.importer.encoding = options.encoding;
  return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings);
}

function projectNote(note: AtNote, kind: TrackKind): NoteProjection {
  const tuning = note.beat.voice.bar.staff.tuning;
  const slides = [SLIDES_IN.get(note.slideInType), SLIDES_OUT.get(note.slideOutType)];
  let string = 0;
  let value = note.fret;
  if (note.isPercussion) {
    // gpif notes index the track's articulation list; GP3 to GP5 notes hold the sound itself.
    const articulations = note.beat.voice.bar.staff.track.percussionArticulations;
    value =
      articulations[note.percussionArticulation]?.outputMidiNumber ?? note.percussionArticulation;
  } else if (kind === 'pitched') {
    // GP6's `Octave`/`Tone` form has no string; `realValue` is the note either way.
    value = note.isPiano ? note.realValue : note.fret + note.stringTuning;
  } else string = tuning.length - note.string + 1;
  // `Note.finish` splices the point list but keeps its ends and `maxBendPoint`.
  const bend = note.hasBend ? values(note.bendPoints) : null;
  return {
    string,
    value,
    tie: note.isTieDestination,
    dead: note.isDead,
    ghost: note.isGhost,
    hammerPull: note.isHammerPullDestination,
    slides: slides.filter((slide) => slide !== undefined).sort(),
    bendPoints: bend?.length ?? null,
    bendFrom: bend?.[0] ?? null,
    bendTo: bend?.at(-1) ?? null,
    bendMax: bend ? (note.maxBendPoint?.value ?? null) : null,
    harmonic: HARMONICS.get(note.harmonicType) ?? null,
    harmonicValue: HARMONICS.has(note.harmonicType) ? note.harmonicValue : null,
    palmMute: note.isPalmMute,
    letRing: note.isLetRing,
    vibrato: named(VIBRATO, note.vibrato),
    // The model keeps a MIDI note off fretted tracks, where alphaTab's `trillFret` is still a fret.
    trill: note.isTrill
      ? [kind === 'fretted' ? note.trillFret : note.trillValue, note.trillSpeed]
      : null,
    staccato: note.isStaccato,
    accent: named(ACCENTS, note.accentuated),
    dynamics: named(DYNAMICS, note.dynamics),
    leftFinger: finger(note.leftHandFinger),
    rightFinger: finger(note.rightHandFinger),
  };
}

function chordOf(beat: AtBeat): ChordProjection | null {
  const chord = beat.chord;
  if (chord === null) return null;
  const frets = chord.strings.map((fret) => (fret < 0 ? null : fret));
  if (!frets.some((fret) => fret !== null)) {
    return { name: chord.name, baseFret: null, frets: null, barres: null };
  }
  return {
    name: chord.name,
    baseFret: chord.firstFret,
    frets,
    barres: [...chord.barreFrets].sort((a, b) => a - b),
  };
}

/** alphaTab keeps the file's mark count: one mark an eighth, two a sixteenth, three a 32nd. */
function tremoloOf(beat: AtBeat): number | null {
  const marks = beat.tremoloPicking?.marks ?? 0;
  return marks > 0 ? 4 * 2 ** marks : null;
}

function strokeOf(beat: AtBeat, kinds: readonly alphaTab.model.BrushType[]): string | null {
  if (!kinds.includes(beat.brushType)) return null;
  const direction =
    beat.brushType === BrushType.BrushUp || beat.brushType === BrushType.ArpeggioUp ? 'up' : 'down';
  const duration = beat.brushDuration > 0 ? (4 * QUARTER_TICKS) / beat.brushDuration : undefined;
  return strokeName(direction, duration);
}

/** `Beat.finishTuplet` has already moved the tempo automations onto the master bar. */
function mixOf(beat: AtBeat): MixProjection | null {
  const value = (type: alphaTab.model.AutomationType): number | null =>
    beat.automations.find((automation) => automation.type === type)?.value ?? null;
  const projected = {
    program: value(AutomationType.Instrument),
    volume: value(AutomationType.Volume),
    pan: value(AutomationType.Balance),
  };
  return Object.values(projected).every((item) => item === null) ? null : projected;
}

function projectBeat(
  beat: AtBeat,
  kind: TrackKind,
  graces: GraceProjection[],
  first: boolean,
): BeatProjection {
  const whammy = beat.hasWhammyBar ? values(beat.whammyBarPoints) : null;
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
    whammyPoints: whammy?.length ?? null,
    whammyFrom: whammy?.[0] ?? null,
    whammyTo: whammy?.at(-1) ?? null,
    whammyMax: whammy ? (beat.maxWhammyPoint?.value ?? null) : null,
    whammyMin: whammy ? (beat.minWhammyPoint?.value ?? null) : null,
    brush: strokeOf(beat, [BrushType.BrushUp, BrushType.BrushDown]),
    arpeggio: strokeOf(beat, [BrushType.ArpeggioUp, BrushType.ArpeggioDown]),
    pickStroke: PICK_STROKES.get(beat.pickStroke) ?? null,
    fade: FADES.get(beat.fade) ?? null,
    tapping: beat.tap,
    slapping: beat.slap,
    popping: beat.pop,
    mix: normaliseMix(mixOf(beat), beat.voice.bar.staff.track.playbackInfo.program, first),
    lyrics: beat.lyrics ? [...beat.lyrics] : null,
    notes: beat.notes.map((note) => projectNote(note, kind)),
  };
}

/** alphaTab keeps grace notes as beats of their own ahead of the main beat; the model nests
 * them in it. */
function projectBeats(beats: AtBeat[], kind: TrackKind, first: boolean): BeatProjection[] {
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
    result.push(projectBeat(beat, kind, graces, first && beat.index === 0));
    pending = [];
  }
  // A grace with no main beat after it has nothing to nest in; it shows up as a beat of its own.
  for (const grace of pending) result.push(projectBeat(grace, kind, [], false));
  return result;
}

function projectBar(bar: AtBar, kind: TrackKind): TrackProjection['bars'][number] {
  return {
    clef: named(CLEFS, bar.clef),
    voices: normaliseVoices(
      bar.voices.map((voice) => ({
        beats: projectBeats(voice.beats, kind, bar.index === 0 && voice.index === 0),
      })),
    ),
  };
}

function projectTrack(track: AtTrack, kind: TrackKind): TrackProjection {
  const staff = track.staves[0];
  const tuning = [...(staff?.tuning ?? [])].reverse();
  const { playbackInfo } = track;
  return {
    name: track.name,
    strings: tuning.length,
    tuning,
    capo: staff?.capo ?? 0,
    percussion: staff?.isPercussion ?? false,
    program: playbackInfo.program,
    bank: playbackInfo.bank,
    volume: playbackInfo.volume,
    pan: playbackInfo.balance,
    mute: playbackInfo.isMute,
    solo: playbackInfo.isSolo,
    color: track.color.rgba.toLowerCase(),
    octaveShift: -(staff?.displayTranspositionPitch ?? 0) / 12,
    bars: (staff?.bars ?? []).map((bar) => projectBar(bar, kind)),
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
    sectionLetter: masterBar.section?.marker ?? null,
    // Both importers draw a double bar as `LightLight` on every staff's bar; `isDoubleBar` is deprecated.
    doubleBar: bar?.barLineRight === BarLineStyle.LightLight,
    tripletFeel: named(TRIPLET_FEELS, masterBar.tripletFeel),
    anacrusis: masterBar.isAnacrusis,
    directions: [...(masterBar.directions ?? [])]
      .map((direction) => DIRECTIONS.get(direction) ?? `unknown ${String(direction)}`)
      .sort(),
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
    meta: {
      title: score.title,
      subtitle: score.subTitle,
      artist: score.artist,
      album: score.album,
      words: score.words,
      music: score.music,
      copyright: score.copyright,
      tab: score.tab,
      instructions: score.instructions,
      notices: score.notices,
    },
    tracks: score.tracks.map((track, index) => projectTrack(track, kinds[index] ?? 'fretted')),
    masterBars: score.masterBars.map((masterBar, index) =>
      projectMasterBar(masterBar, index === 0 ? score.tempo : null),
    ),
  };
}
