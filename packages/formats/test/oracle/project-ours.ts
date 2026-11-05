import { beatStartTicks } from '@reprise/model';
import type { Beat, MasterBar, Note, Score, Track, TrackKind } from '@reprise/model';

import {
  keyName,
  strokeName,
  trimVoices,
  tupletName,
  type BeatProjection,
  type MasterBarProjection,
  type NoteProjection,
  type ScoreProjection,
  type TrackProjection,
} from './projection';

function projectNote(note: Note, kind: TrackKind): NoteProjection {
  return {
    string: kind === 'fretted' ? note.string : 0,
    value: note.fret,
    tie: note.tie,
    dead: note.dead,
    ghost: note.ghost,
    hammerPull: note.hammerPull,
    slides: [...(note.slide ?? [])].sort(),
    bendPoints: note.bend?.points.length ?? null,
    harmonic: note.harmonic?.kind ?? null,
    palmMute: note.palmMute,
    letRing: note.letRing,
    vibrato: note.vibrato,
    trill: note.trill ? [note.trill.fret, note.trill.speed] : null,
    staccato: note.staccato,
    accent: note.accent,
    dynamics: note.dynamics,
  };
}

function projectBeat(beat: Beat, kind: TrackKind): BeatProjection {
  const { effects } = beat;
  const diagram = beat.chord?.diagram;
  return {
    duration: beat.duration,
    dots: beat.dots,
    tuplet: beat.tuplet ? tupletName(beat.tuplet.n, beat.tuplet.of) : null,
    rest: beat.rest,
    graces: (beat.grace ?? []).map((grace) => ({
      duration: grace.duration,
      before: grace.before,
      notes: grace.notes.map((note) => projectNote(note, kind)),
    })),
    text: beat.text ?? null,
    chord: beat.chord
      ? { name: beat.chord.name, frets: diagram ? [...diagram.frets] : null }
      : null,
    tremoloPicking: effects.tremoloPicking ?? null,
    vibrato: effects.vibrato ?? 'none',
    whammyPoints: effects.whammy?.points.length ?? null,
    brush: effects.brush ? strokeName(effects.brush.direction, effects.brush.duration) : null,
    lyrics: beat.lyrics ? [...beat.lyrics] : null,
    notes: beat.notes.map((note) => projectNote(note, kind)),
  };
}

function projectTrack(track: Track): TrackProjection {
  return {
    name: track.name,
    strings: track.tuning.length,
    tuning: [...track.tuning],
    capo: track.capo,
    percussion: track.kind === 'drums',
    bars: track.bars.map((bar) => ({
      voices: trimVoices(
        bar.voices.map((voice) => ({
          beats: voice.beats.map((beat) => projectBeat(beat, track.kind)),
        })),
      ),
    })),
  };
}

/** The bar's own mark, then the beats' mixer tempos in time order across tracks and voices. */
function barTempos(score: Score, index: number, masterBar: MasterBar): number[] {
  const changes: { tick: number; bpm: number }[] = [];
  for (const track of score.tracks) {
    for (const voice of track.bars[index]?.voices ?? []) {
      voice.beats.forEach((beat, i) => {
        if (beat.mix?.tempo)
          changes.push({ tick: beatStartTicks(voice, i), bpm: beat.mix.tempo.bpm });
      });
    }
  }
  changes.sort((a, b) => a.tick - b.tick);
  const tempos = masterBar.tempo ? [masterBar.tempo.bpm] : [];
  for (const { bpm } of changes) if (tempos.at(-1) !== bpm) tempos.push(bpm);
  return tempos;
}

export function projectOurs(score: Score): ScoreProjection {
  return {
    tracks: score.tracks.map(projectTrack),
    masterBars: score.masterBars.map((masterBar, index): MasterBarProjection => ({
      timeSignature: `${String(masterBar.timeSignature.numerator)}/${String(masterBar.timeSignature.denominator)}`,
      key: keyName(masterBar.keySignature.fifths, masterBar.keySignature.minor),
      repeatStart: masterBar.repeat.start,
      repeatEnd: masterBar.repeat.endCount,
      alternateEndings: [...masterBar.alternateEndings].sort((a, b) => a - b),
      tempos: barTempos(score, index, masterBar),
      section: masterBar.section?.name ?? null,
    })),
  };
}
