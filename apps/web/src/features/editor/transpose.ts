import {
  chain,
  setBeatEffects,
  setMasterBars,
  tieChainOf,
  transpose,
  transposeSelection,
  type Beat,
  type BeatEffectEdit,
  type Command,
  type Id,
  type KeySignature,
  type MasterBarEdit,
  type Note,
  type Score,
  type Selection,
  type Track,
  type TransposeFailure,
} from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { SelectionState } from '@/state/selection';

import { shiftDiagram, transposeChordName, transposeKey } from './chord-names';
import { editTarget } from './range';

export type TransposeScope = 'selection' | 'track' | 'song';

export interface TransposeOptions {
  /** Whole semitones, positive up. */
  semitones: number;
  scope: TransposeScope;
  /** Move the chord names (and their diagrams) of the beats in scope. */
  chordNames: boolean;
  /** Move each bar's key signature; only when the scope covers every non-drum track. */
  keySignature: boolean;
}

export interface TransposeInput {
  score: Score;
  state: Pick<SelectionState, 'cursor' | 'range' | 'selection' | 'currentTrack'>;
  visible?: readonly Id[];
}

export type TransposePlan =
  { command: Command; notice?: string } | { refused: string } | { nothing: true };

interface Placed {
  track: Track;
  trackIndex: number;
  bar: number;
  voice: number;
  index: number;
  beat: Beat;
}

interface Reach {
  /** What `transposeSelection` gets: drum tracks are left out. */
  selection: Selection;
  beats: Placed[];
  picked: { at: Placed; note: Note }[];
  /** Whether the scope names beats, which have chord names; notes picked on their own do not. */
  beatTarget: boolean;
  sawDrums: boolean;
}

function placedBeats(track: Track, trackIndex: number): Placed[] {
  return track.bars.flatMap((bar, barIndex) =>
    bar.voices.flatMap((voice, voiceIndex) =>
      voice.beats.map((beat, index) => ({
        track,
        trackIndex,
        bar: barIndex,
        voice: voiceIndex,
        index,
        beat,
      })),
    ),
  );
}

function placedOf(score: Score, id: Id): Placed | undefined {
  const info = scoreIndex(score).beats.get(id);
  if (!info) return undefined;
  const track = score.tracks[info.trackIndex];
  const beat = track?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  return track && beat
    ? {
        track,
        trackIndex: info.trackIndex,
        bar: info.masterBarIndex,
        voice: info.voice,
        index: info.index,
        beat,
      }
    : undefined;
}

/** The track the "current track" scope means: the selection's own, else the first. */
function currentTrack(input: TransposeInput): { track: Track; index: number } | undefined {
  const { score, state } = input;
  const found = score.tracks.findIndex(({ id }) => id === state.currentTrack);
  const index = found < 0 ? 0 : found;
  const track = score.tracks[index];
  return track && { track, index };
}

function reachOf(input: TransposeInput, scope: TransposeScope): Reach {
  const { score, state, visible } = input;
  let beats: Placed[] = [];
  let picked: Reach['picked'] = [];
  let beatTarget = true;
  if (scope === 'selection') {
    const target = editTarget(score, state, visible);
    beats = (target.beatIds ?? []).flatMap((id) => placedOf(score, id) ?? []);
    beatTarget = beats.length > 0;
    const index = scoreIndex(score);
    picked = (target.noteIds ?? []).flatMap((id) => {
      const owner = index.noteBeat.get(id);
      const at = owner === undefined ? undefined : placedOf(score, owner);
      const note = at?.beat.notes.find((n) => n.id === id);
      const grace = at?.beat.grace?.flatMap((g) => g.notes).find((n) => n.id === id);
      const found = note ?? grace;
      return at && found ? [{ at, note: found }] : [];
    });
  } else if (scope === 'track') {
    const current = currentTrack(input);
    if (current) beats = placedBeats(current.track, current.index);
  } else {
    beats = score.tracks.flatMap((track, index) => placedBeats(track, index));
  }
  const pitched = (at: Placed) => at.track.kind !== 'drums';
  const sawDrums =
    beats.some((at) => !pitched(at) && at.beat.notes.length > 0) ||
    picked.some(({ at }) => !pitched(at));
  const kept = beats.filter(pitched);
  const keptNotes = picked.filter(({ at }) => pitched(at));
  return {
    selection: {
      ...(kept.length > 0 && { beatIds: kept.map(({ beat }) => beat.id) }),
      ...(keptNotes.length > 0 && { noteIds: keptNotes.map(({ note }) => note.id) }),
    },
    beats: kept,
    picked: keptNotes,
    beatTarget,
    sawDrums,
  };
}

/** Whether the scope reaches every non-drum track, the only case that may move the shared key. */
export function coversEveryTrack(input: TransposeInput, scope: TransposeScope): boolean {
  const pitched = input.score.tracks.filter(({ kind }) => kind !== 'drums');
  if (pitched.length === 0) return false;
  if (scope === 'song') return true;
  if (scope !== 'track') return false;
  const current = currentTrack(input)?.track;
  return pitched.length === 1 && current === pitched[0];
}

/** Whether the scope names beats, so chord names can move with it. */
export function offersChordNames(input: TransposeInput, scope: TransposeScope): boolean {
  return scope !== 'selection' || reachOf(input, scope).beatTarget;
}

/** Whether the "Selection" scope reaches any pitched note or beat. */
export function selectionHasTarget(input: TransposeInput): boolean {
  const { selection } = reachOf(input, 'selection');
  return (selection.beatIds?.length ?? 0) + (selection.noteIds?.length ?? 0) > 0;
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

/** The refusal sentence: where the note is, and what it would run into. */
function refusalText(
  track: Track,
  trackIndex: number,
  bar: number,
  note: Note,
  semitones: number,
  reason: TransposeFailure,
): string {
  const where = [`Track ${String(trackIndex + 1)}`, `bar ${String(bar + 1)}`];
  if (track.kind === 'fretted') where.push(`string ${String(note.string)}`);
  const amount = plural(Math.abs(semitones), 'semitone', 'semitones');
  const direction = semitones < 0 ? 'down' : 'up';
  const subject =
    track.kind === 'fretted' ? `fret ${String(note.fret)}` : `note ${String(note.fret)}`;
  let end: string;
  if (reason === 'belowOpenString') {
    end = track.capo > 0 ? 'falling below the capo' : 'falling below the open string';
  } else if (reason === 'aboveLastFret') {
    end = `going past fret ${String(track.fretCount)}`;
  } else {
    end = 'leaving the MIDI range';
  }
  return `${where.join(', ')}: ${subject} cannot go ${direction} ${amount} without ${end}`;
}

/**
 * Plans a transposition as one `Transpose` command: the notes of the scope on their own strings
 * (and the notes tied to them), the chord names and diagrams of its beats, and the key
 * signatures when the scope covers every pitched track. A note that would leave the neck refuses
 * the whole thing with a sentence naming its track, bar and string, found before anything is
 * built so a refusal is cheap. The capo never moves and notes never change string.
 */
export function planTranspose(input: TransposeInput, options: TransposeOptions): TransposePlan {
  const { score } = input;
  const { semitones } = options;
  if (semitones === 0) return { nothing: true };
  const reach = reachOf(input, options.scope);

  // Pre-check what the model will move, with its own rules: grace notes of the beats, the notes
  // picked, and the notes tied to a main note.
  const seen = new Set<Note>();
  let trills = 0;
  let harmonics = 0;
  let refused: string | undefined;
  const visit = (at: Placed, bar: number, note: Note): void => {
    if (refused !== undefined || seen.has(note) || note.dead) return;
    seen.add(note);
    const result = transpose(at.track, note, semitones);
    if (!result.ok) {
      refused = refusalText(at.track, at.trackIndex, bar, note, semitones, result.reason);
      return;
    }
    trills += result.warnings.filter((code) => code === 'trill-dropped').length;
    harmonics += result.warnings.filter((code) => code === 'natural-harmonic-moved').length;
  };
  const visitMain = (at: Placed, note: Note): void => {
    visit(at, at.bar, note);
    for (const link of tieChainOf(
      at.track,
      { bar: at.bar, voice: at.voice, beat: at.index },
      note,
    )) {
      visit(at, link.bar, link.note);
    }
  };
  for (const at of reach.beats) {
    for (const note of at.beat.notes) visitMain(at, note);
    for (const grace of at.beat.grace ?? [])
      for (const note of grace.notes) visit(at, at.bar, note);
  }
  for (const { at, note } of reach.picked) {
    if (at.beat.notes.includes(note)) visitMain(at, note);
    else visit(at, at.bar, note);
  }
  if (refused !== undefined) return { refused };

  const steps: Command[] = [];
  const notes: string[] = [];
  if (seen.size > 0) steps.push(transposeSelection(reach.selection, semitones));

  const keys: KeySignature[] = score.masterBars.map((bar) => bar.keySignature);
  const keyEdits: MasterBarEdit[] = [];
  if (options.keySignature && coversEveryTrack(input, options.scope) && semitones % 12 !== 0) {
    score.masterBars.forEach((bar, index) => {
      const next = transposeKey(bar.keySignature, semitones);
      if (next.fifths === bar.keySignature.fifths) return;
      keys[index] = next;
      keyEdits.push({ masterBarId: bar.id, changes: { keySignature: next } });
    });
  }

  const chordEdits: BeatEffectEdit[] = [];
  let unreadable = 0;
  let removedDiagrams = 0;
  if (options.chordNames && reach.beatTarget && semitones % 12 !== 0) {
    for (const at of reach.beats) {
      const { chord } = at.beat;
      if (!chord) continue;
      const key = keys[at.bar] ?? { fifths: 0, minor: false };
      const name = transposeChordName(chord.name, semitones, key);
      if (name === undefined) {
        unreadable += 1;
        continue;
      }
      const diagram = chord.diagram && shiftDiagram(chord.diagram, semitones, at.track.fretCount);
      if (chord.diagram && !diagram) removedDiagrams += 1;
      chordEdits.push({
        beatId: at.beat.id,
        changes: { chord: { name, ...(diagram && { diagram }) } },
      });
    }
  }
  if (chordEdits.length > 0) steps.push(setBeatEffects(chordEdits));
  if (keyEdits.length > 0) steps.push(setMasterBars(keyEdits));
  if (steps.length === 0) return { nothing: true };

  if (trills > 0) {
    notes.push(
      `${plural(trills, 'trill', 'trills')} fell off the neck and ${trills === 1 ? 'was' : 'were'} removed`,
    );
  }
  if (harmonics > 0) {
    notes.push(
      harmonics === 1
        ? '1 natural harmonic no longer sits on its node'
        : `${String(harmonics)} natural harmonics no longer sit on their nodes`,
    );
  }
  if (unreadable > 0) {
    notes.push(
      `${plural(unreadable, 'chord name', 'chord names')} could not be read and ${unreadable === 1 ? 'was' : 'were'} left as written`,
    );
  }
  if (removedDiagrams > 0) {
    notes.push(
      `${plural(removedDiagrams, 'chord diagram', 'chord diagrams')} could not move and ${removedDiagrams === 1 ? 'was' : 'were'} removed`,
    );
  }
  if (reach.sawDrums) notes.push('Drum tracks were left as they are');
  const [first = '', ...rest] = notes;
  const notice =
    notes.length > 0
      ? `${first.charAt(0).toUpperCase()}${first.slice(1)}${rest.map((n) => `. ${n.charAt(0).toUpperCase()}${n.slice(1)}`).join('')}`
      : undefined;
  return { command: chain('Transpose', steps), ...(notice && { notice }) };
}
