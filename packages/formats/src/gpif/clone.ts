import {
  newId,
  type Beat,
  type BeatEffects,
  type Chord,
  type ChordDiagram,
  type MixerChange,
  type Note,
} from '@reprise/model';

import { cloneNoteFields } from './build-tracks';

/**
 * Deep copies with fresh ids. Guitar Pro 7 stores one beat or note once and refers to it from
 * every place it repeats, and simile marks copy whole bars, but every model node needs its own
 * id and nothing may be shared, so each reference gets a copy.
 */
export function cloneNote(note: Note): Note {
  const copy: Note = { ...note, ...cloneNoteFields(note), id: newId() };
  return copy;
}

export function cloneEffects(effects: BeatEffects): BeatEffects {
  const copy: BeatEffects = { ...effects };
  if (effects.arpeggio) copy.arpeggio = { ...effects.arpeggio };
  if (effects.brush) copy.brush = { ...effects.brush };
  if (effects.whammy) {
    copy.whammy = {
      kind: effects.whammy.kind,
      points: effects.whammy.points.map((point) => ({ ...point })),
    };
  }
  return copy;
}

export function cloneChord(chord: Chord): Chord {
  if (!chord.diagram) return { name: chord.name };
  const { baseFret, frets, fingering, barres } = chord.diagram;
  const diagram: ChordDiagram = { baseFret, frets: [...frets] };
  if (fingering) diagram.fingering = [...fingering];
  if (barres) diagram.barres = barres.map((barre) => ({ ...barre }));
  return { name: chord.name, diagram };
}

function cloneMix(mix: MixerChange): MixerChange {
  const copy: MixerChange = {};
  for (const key of ['volume', 'pan', 'chorus', 'reverb', 'phaser', 'tremolo'] as const) {
    const change = mix[key];
    if (change) copy[key] = { ...change };
  }
  if (mix.program !== undefined) copy.program = mix.program;
  if (mix.tempo) copy.tempo = { ...mix.tempo };
  return copy;
}

export function cloneBeat(beat: Beat): Beat {
  const copy: Beat = {
    ...beat,
    id: newId(),
    notes: beat.notes.map((note) => cloneNote(note)),
    effects: cloneEffects(beat.effects),
  };
  if (beat.tuplet) copy.tuplet = { ...beat.tuplet };
  if (beat.chord) copy.chord = cloneChord(beat.chord);
  if (beat.lyrics) copy.lyrics = [...beat.lyrics];
  if (beat.mix) copy.mix = cloneMix(beat.mix);
  if (beat.grace) {
    copy.grace = beat.grace.map((grace) => ({
      ...grace,
      notes: grace.notes.map((note) => cloneNote(note)),
    }));
  }
  return copy;
}
