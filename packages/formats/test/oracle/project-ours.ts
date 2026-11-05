import { beatStartTicks } from '@reprise/model';
import type {
  Bar,
  Beat,
  BendPoint,
  MasterBar,
  Note,
  Score,
  Track,
  TrackKind,
} from '@reprise/model';

import {
  controllerLevel,
  keyName,
  normaliseMix,
  normaliseVoices,
  strokeName,
  tupletName,
  type BeatProjection,
  type ChordProjection,
  type MasterBarProjection,
  type MixProjection,
  type NoteProjection,
  type ScoreProjection,
  type TrackProjection,
} from './projection';

const values = (points: readonly BendPoint[]): number[] => points.map((point) => point.value);

function projectNote(note: Note, kind: TrackKind): NoteProjection {
  const bend = note.bend ? values(note.bend.points) : null;
  return {
    string: kind === 'fretted' ? note.string : 0,
    value: note.fret,
    tie: note.tie,
    dead: note.dead,
    ghost: note.ghost,
    hammerPull: note.hammerPull,
    slides: [...(note.slide ?? [])].sort(),
    bendPoints: bend?.length ?? null,
    bendFrom: bend?.[0] ?? null,
    bendTo: bend?.at(-1) ?? null,
    bendMax: bend ? Math.max(...bend) : null,
    harmonic: note.harmonic?.kind ?? null,
    harmonicValue: note.harmonic?.value ?? null,
    palmMute: note.palmMute,
    letRing: note.letRing,
    vibrato: note.vibrato,
    trill: note.trill ? [note.trill.fret, note.trill.speed] : null,
    staccato: note.staccato,
    accent: note.accent,
    dynamics: note.dynamics,
    leftFinger: note.leftHandFinger ?? null,
    rightFinger: note.rightHandFinger ?? null,
  };
}

function chordOf(beat: Beat): ChordProjection | null {
  if (!beat.chord) return null;
  const diagram = beat.chord.diagram;
  return {
    name: beat.chord.name,
    baseFret: diagram?.baseFret ?? null,
    frets: diagram ? [...diagram.frets] : null,
    barres: diagram
      ? (diagram.barres ?? []).map((barre) => barre.fret).sort((a, b) => a - b)
      : null,
  };
}

function mixOf(beat: Beat): MixProjection | null {
  const { mix } = beat;
  if (!mix) return null;
  const projected = {
    program: mix.program ?? null,
    volume: mix.volume ? controllerLevel(mix.volume.value) : null,
    pan: mix.pan ? controllerLevel(mix.pan.value) : null,
  };
  return Object.values(projected).every((value) => value === null) ? null : projected;
}

function fadeOf(beat: Beat): string | null {
  const { effects } = beat;
  if (effects.fadeIn) return 'in';
  if (effects.fadeOut) return 'out';
  if (effects.volumeSwell) return 'swell';
  return null;
}

function projectBeat(beat: Beat, kind: TrackKind, program: number, first: boolean): BeatProjection {
  const { effects } = beat;
  const whammy = effects.whammy ? values(effects.whammy.points) : null;
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
    chord: chordOf(beat),
    tremoloPicking: effects.tremoloPicking ?? null,
    vibrato: effects.vibrato ?? 'none',
    whammyPoints: whammy?.length ?? null,
    whammyFrom: whammy?.[0] ?? null,
    whammyTo: whammy?.at(-1) ?? null,
    whammyMax: whammy ? Math.max(...whammy) : null,
    whammyMin: whammy ? Math.min(...whammy) : null,
    brush: effects.brush ? strokeName(effects.brush.direction, effects.brush.duration) : null,
    arpeggio: effects.arpeggio
      ? strokeName(effects.arpeggio.direction, effects.arpeggio.duration)
      : null,
    pickStroke: effects.pickStroke ?? null,
    fade: fadeOf(beat),
    tapping: effects.tapping ?? false,
    slapping: effects.slapping ?? false,
    popping: effects.popping ?? false,
    mix: normaliseMix(mixOf(beat), program, first),
    lyrics: beat.lyrics ? [...beat.lyrics] : null,
    notes: beat.notes.map((note) => projectNote(note, kind)),
  };
}

/** `Bar.clef` is a change from its bar on; the track's display clef holds until the first. */
function clefs(track: Track): string[] {
  let current: string = track.display.clef ?? 'treble';
  return track.bars.map((bar: Bar) => {
    current = bar.clef ?? current;
    return current;
  });
}

function projectTrack(track: Track): TrackProjection {
  const barClefs = clefs(track);
  return {
    name: track.name,
    strings: track.tuning.length,
    tuning: [...track.tuning],
    capo: track.capo,
    percussion: track.kind === 'drums',
    program: track.program,
    bank: track.bank,
    volume: controllerLevel(track.channel.volume),
    pan: controllerLevel(track.channel.pan),
    mute: track.channel.mute,
    solo: track.channel.solo,
    color: track.color,
    octaveShift: track.display.octaveShift,
    bars: track.bars.map((bar, barIndex) => ({
      clef: barClefs[barIndex] ?? 'treble',
      voices: normaliseVoices(
        bar.voices.map((voice, voiceIndex) => ({
          beats: voice.beats.map((beat, beatIndex) =>
            projectBeat(
              beat,
              track.kind,
              track.program,
              barIndex === 0 && voiceIndex === 0 && beatIndex === 0,
            ),
          ),
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

function projectMasterBar(score: Score, masterBar: MasterBar, index: number): MasterBarProjection {
  return {
    timeSignature: `${String(masterBar.timeSignature.numerator)}/${String(masterBar.timeSignature.denominator)}`,
    key: keyName(masterBar.keySignature.fifths, masterBar.keySignature.minor),
    repeatStart: masterBar.repeat.start,
    repeatEnd: masterBar.repeat.endCount,
    alternateEndings: [...masterBar.alternateEndings].sort((a, b) => a - b),
    tempos: barTempos(score, index, masterBar),
    section: masterBar.section?.name ?? null,
    sectionLetter: masterBar.section ? (masterBar.section.letter ?? '') : null,
    doubleBar: masterBar.doubleBar,
    tripletFeel: masterBar.tripletFeel,
    anacrusis: masterBar.anacrusis,
    directions: [...masterBar.jumps.map((jump) => jump.kind), ...masterBar.targets].sort(),
  };
}

export function projectOurs(score: Score): ScoreProjection {
  const { meta } = score;
  return {
    meta: {
      title: meta.title,
      subtitle: meta.subtitle,
      artist: meta.artist,
      album: meta.album,
      words: meta.words,
      music: meta.music,
      copyright: meta.copyright,
      tab: meta.tab,
      instructions: meta.instructions,
      notices: meta.notices.join('\r\n'),
    },
    tracks: score.tracks.map(projectTrack),
    masterBars: score.masterBars.map((masterBar, index) =>
      projectMasterBar(score, masterBar, index),
    ),
  };
}
