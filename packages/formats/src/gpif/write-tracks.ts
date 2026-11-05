import {
  PERCUSSION_INSTRUMENTS,
  barTicks,
  beatStartTicks,
  type Chord,
  type Finger,
  type MasterBar,
  type NativePath,
  type NoteHead,
  type Track,
} from '@reprise/model';

import type { DropCollector } from './dropped';
import type { XmlWriter } from './xml-writer';

/** General MIDI programs of fretted instruments, the reader's rule for telling a keyboard apart. */
export function isFrettedProgram(program: number): boolean {
  return (program >= 24 && program <= 39) || (program >= 104 && program <= 107);
}

/** `PartConfiguration` flag bits: 1 standard notation, 2 tablature. */
export const STANDARD_FLAG = 1;
export const TAB_FLAG = 2;

/**
 * The part-configuration flags that make the reader rebuild this track's kind and notation. A
 * pitched or drum track shows standard notation only; a fretted track whose program is outside
 * the fretted families must show tablature, or the reader takes it for a keyboard.
 */
export function notationFlags(track: Track): number {
  if (track.kind !== 'fretted') return STANDARD_FLAG;
  const flags =
    track.display.notation === 'both'
      ? STANDARD_FLAG | TAB_FLAG
      : track.display.notation === 'tab'
        ? TAB_FLAG
        : STANDARD_FLAG;
  return isFrettedProgram(track.program) ? flags : flags | TAB_FLAG;
}

export function reportTrackLosses(track: Track, index: number, drops: DropCollector): void {
  const path: NativePath = ['tracks', index];
  if (track.kind !== 'fretted' && track.display.notation !== 'standard') {
    drops.drop(
      'notation',
      [...path, 'display', 'notation'],
      'A drum or keyboard track always reads back as standard notation',
    );
  }
  if (track.kind === 'fretted' && !isFrettedProgram(track.program)) {
    if (track.display.notation === 'standard') {
      drops.drop(
        'notation',
        [...path, 'display', 'notation'],
        'A fretted track with a non-guitar sound must show tablature in gp, or it reads back as a keyboard',
      );
    }
  }
  if (track.kind === 'pitched' && track.tuning.length > 0 && isFrettedProgram(track.program)) {
    drops.drop(
      'notation',
      [...path, 'kind'],
      'A keyboard track with a guitar sound and a tuning reads back as a fretted track',
    );
  }
  if (track.kind !== 'fretted' && track.capo !== 0) {
    drops.drop('capo', [...path, 'capo'], 'Only a fretted track keeps a capo');
  }
  const { chorus, reverb, phaser, tremolo } = track.channel;
  if (chorus !== 0 || reverb !== 0 || phaser !== 0 || tremolo !== 0) {
    drops.drop(
      'channel-effect',
      [...path, 'channel'],
      'Channel chorus, reverb, phaser and tremolo have no gp equivalent',
    );
  }
  if (track.sound) {
    drops.drop('sound-override', [...path, 'sound'], 'The HQ sound assignment is not in gp files');
  }
}

/** One `Sound` of a track; automations name it by `path;name;role`. */
export interface TrackSound {
  name: string;
  path: string;
  role: string;
  program: number;
  bank: number;
}

export const soundKey = (sound: TrackSound): string => `${sound.path};${sound.name};${sound.role}`;

export interface SoundChange {
  bar: number;
  position: number;
  sound: TrackSound;
}

/** What one track needs written before its bars: chord diagrams, sounds and their changes. */
export interface TrackPlan {
  /** Chord collection item id by structural key, in first-use order. */
  chordIds: Map<string, string>;
  chords: Chord[];
  sounds: TrackSound[];
  soundChanges: SoundChange[];
}

export const chordKey = (chord: Chord): string => JSON.stringify(chord);

function sound(program: number, bank: number, initial: boolean): TrackSound {
  return {
    name: initial ? 'Track sound' : `Program ${String(program)}`,
    path: `Midi/${String(program)}`,
    role: initial ? 'Factory' : 'User',
    program,
    bank,
  };
}

/**
 * Collects a track's chords, deduplicated by structure since gpif stores each diagram once per
 * staff, and its program changes as `Sound` automations. A change at the very start to the
 * track's own program says nothing and is not written; the reader would skip it anyway.
 */
export function planTrack(
  track: Track,
  index: number,
  masterBars: readonly MasterBar[],
  drops: DropCollector,
): TrackPlan {
  const initial = sound(track.program, track.bank, true);
  const plan: TrackPlan = { chordIds: new Map(), chords: [], sounds: [initial], soundChanges: [] };
  const byProgram = new Map<number, TrackSound>();
  const changeAt = new Map<string, number>();
  plan.soundChanges.push({ bar: 0, position: 0, sound: initial });

  track.bars.forEach((bar, barIndex) => {
    const masterBar = masterBars[barIndex];
    const length = masterBar ? barTicks(masterBar) : 1;
    bar.voices.forEach((voice, voiceIndex) => {
      voice.beats.forEach((beat, beatIndex) => {
        if (beat.chord && !plan.chordIds.has(chordKey(beat.chord))) {
          plan.chordIds.set(chordKey(beat.chord), String(plan.chords.length));
          plan.chords.push(beat.chord);
        }
        const program = beat.mix?.program;
        if (program === undefined) return;
        const tick = beatStartTicks(voice, beatIndex);
        if (barIndex === 0 && tick === 0 && program === track.program) return;
        const where = `${String(barIndex)}@${String(Math.round(tick * 1000))}`;
        const earlier = changeAt.get(where);
        if (earlier !== undefined) {
          if (earlier !== program) {
            drops.drop(
              'mixer-change',
              ['tracks', index, 'bars', barIndex, 'voices', voiceIndex, 'beats', beatIndex, 'mix'],
              'Two program changes at one moment of a track; the first voice wins',
            );
          }
          return;
        }
        changeAt.set(where, program);
        let target = byProgram.get(program);
        if (!target) {
          target = sound(program, track.bank, false);
          byProgram.set(program, target);
          plan.sounds.push(target);
        }
        plan.soundChanges.push({ bar: barIndex, position: tick / length, sound: target });
      });
    });
  });
  return plan;
}

/** Drum articulations: every GM2 percussion sound, then any other MIDI note the track plays. */
export function drumArticulations(track: Track): number[] {
  const known = PERCUSSION_INSTRUMENTS.map((instrument) => instrument.midi);
  const extra = new Set<number>();
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of [...beat.notes, ...(beat.grace ?? []).flatMap((g) => g.notes)]) {
          if (!known.includes(note.fret)) extra.add(note.fret);
        }
      }
    }
  }
  return [...known, ...[...extra].sort((a, b) => a - b)];
}

const NOTEHEADS: Readonly<Record<NoteHead, string>> = {
  normal: 'noteheadBlack noteheadHalf noteheadWhole',
  cross: 'noteheadXBlack noteheadXBlack noteheadXBlack',
  diamond: 'noteheadDiamondWhite noteheadDiamondWhite noteheadDiamondWhite',
  triangle: 'noteheadTriangleUpBlack noteheadTriangleUpHalf noteheadTriangleUpWhole',
};

/** The five-line staff's top line is gpif's line 0 and its bottom line 8; the model counts up from the bottom. */
const BOTTOM_STAFF_LINE = 8;

function articulation(xml: XmlWriter, name: string, line: number, heads: string, midi: number) {
  xml.open('Articulation');
  xml.cdata('Name', name);
  xml.text('StaffLine', line);
  xml.text('Noteheads', heads);
  xml.text('TechniquePlacement', 'outside');
  xml.text('TechniqueSymbol', '');
  xml.text('InputMidiNumbers', midi === 0 ? '' : midi);
  xml.text('OutputRSESound', '');
  xml.text('OutputMidiNumber', midi);
  xml.close('Articulation');
}

/** gpif instrument set names and types for the programs Guitar Pro 7 files show them on. */
function instrumentSet(track: Track): [name: string, type: string] {
  const { program } = track;
  if (track.kind === 'drums') return ['Drums', 'drumKit'];
  if (program === 24) return ['Nylon Guitar', 'nylonGuitar'];
  if (program === 25) return ['Steel Guitar', 'steelGuitar'];
  if (program >= 26 && program <= 31) return ['Electric Guitar', 'electricGuitar'];
  if (program === 32 || program === 35) return ['Acoustic Bass', 'acousticBass'];
  if (program >= 33 && program <= 39) return ['Electric Bass', 'electricBass'];
  if (program === 105) return ['Banjo', 'banjo'];
  return track.kind === 'pitched'
    ? ['Acoustic Piano', 'acousticPiano']
    : ['Steel Guitar', 'steelGuitar'];
}

/**
 * The instrument set: a drum kit lists one articulation per sound (notes index them, and the
 * reader plays each as its `OutputMidiNumber`); any other track has Guitar Pro's single
 * `Pitched` element.
 */
function writeInstrumentSet(xml: XmlWriter, track: Track, drums: number[]): void {
  const [name, type] = instrumentSet(track);
  xml.open('InstrumentSet');
  xml.text('Name', name);
  xml.text('Type', type);
  xml.text('LineCount', 5);
  xml.open('Elements');
  xml.open('Element');
  if (track.kind === 'drums') {
    xml.text('Name', 'Drums');
    xml.text('Type', 'drumKit');
    xml.text('SoundbankName', '');
    xml.open('Articulations');
    for (const midi of drums) {
      const instrument = PERCUSSION_INSTRUMENTS.find((entry) => entry.midi === midi);
      articulation(
        xml,
        instrument?.name ?? `MIDI ${String(midi)}`,
        BOTTOM_STAFF_LINE - (instrument?.staffPosition ?? 4),
        NOTEHEADS[instrument?.noteHead ?? 'normal'],
        midi,
      );
    }
  } else {
    xml.text('Name', 'Pitched');
    xml.text('Type', 'pitched');
    xml.text('SoundbankName', '');
    xml.open('Articulations');
    articulation(xml, '', 0, NOTEHEADS.normal, 0);
  }
  xml.close('Articulations');
  xml.close('Element');
  xml.close('Elements');
  xml.close('InstrumentSet');
}

const DIAGRAM_FINGERS: Readonly<Record<Finger, string>> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  little: 'Pinky',
};

/** The barres the reader derives from a fingering: one finger on several strings at one fret. */
export function impliedBarres(chord: Chord): string {
  const diagram = chord.diagram;
  if (!diagram?.fingering) return '[]';
  const byFinger = new Map<string, number[]>();
  diagram.fingering.forEach((finger, slot) => {
    const fret = diagram.frets[slot];
    if (finger === null || fret === null || fret === undefined) return;
    const key = `${finger}@${String(fret)}`;
    byFinger.set(key, [...(byFinger.get(key) ?? []), slot + 1]);
  });
  const barres = [...byFinger]
    .filter(([key, strings]) => strings.length > 1 && Number(key.slice(key.indexOf('@') + 1)) >= 1)
    .map(([key, strings]) => ({
      fret: Number(key.slice(key.indexOf('@') + 1)),
      firstString: Math.min(...strings),
      lastString: Math.max(...strings),
    }))
    .sort((a, b) => a.fret - b.fret || a.firstString - b.firstString);
  return JSON.stringify(barres);
}

export function sortedBarres(chord: Chord): string {
  const barres = [...(chord.diagram?.barres ?? [])].sort(
    (a, b) => a.fret - b.fret || a.firstString - b.firstString,
  );
  return JSON.stringify(
    barres.map(({ fret, firstString, lastString }) => ({ fret, firstString, lastString })),
  );
}

/**
 * One diagram collection item. gpif numbers diagram strings from the lowest (0) and stores frets
 * relative to a 0-based base fret; the model lists absolute frets from string 1. Barres are not
 * stored at all: the reader derives them from one finger on several strings at one fret.
 */
function writeChordItem(xml: XmlWriter, id: string, chord: Chord): void {
  const diagram = chord.diagram;
  if (!diagram) {
    xml.empty('Item', { id, name: chord.name });
    return;
  }
  const count = diagram.frets.length;
  const base = diagram.baseFret - 1;
  xml.open('Item', { id, name: chord.name });
  xml.open('Diagram', {
    stringCount: String(count),
    fretCount: '5',
    baseFret: String(base),
    barStates: Array.from({ length: count }, () => '1').join(' '),
  });
  diagram.frets.forEach((fret, slot) => {
    if (fret === null) return;
    xml.empty('Fret', { string: String(count - 1 - slot), fret: String(fret - base) });
  });
  xml.open('Fingering');
  diagram.fingering?.forEach((finger, slot) => {
    const fret = diagram.frets[slot];
    if (finger === null || fret === null || fret === undefined) return;
    xml.empty('Position', {
      finger: DIAGRAM_FINGERS[finger],
      fret: String(fret - base),
      string: String(count - 1 - slot),
    });
  });
  xml.close('Fingering');
  for (const name of ['ShowName', 'ShowDiagram', 'ShowFingering']) {
    xml.empty('Property', { name, type: 'bool', value: 'true' });
  }
  xml.close('Diagram');
  xml.close('Item');
}

function property(xml: XmlWriter, name: string, inner: string, value: string | number): void {
  xml.open('Property', { name });
  xml.text(inner, value);
  xml.close('Property');
}

function writeStaff(xml: XmlWriter, track: Track, plan: TrackPlan): void {
  xml.open('Staves');
  xml.open('Staff');
  xml.open('Properties');
  if (track.kind !== 'drums') {
    property(xml, 'CapoFret', 'Fret', track.kind === 'fretted' ? track.capo : 0);
    property(xml, 'FretCount', 'Number', track.fretCount);
    property(xml, 'PartialCapoFret', 'Fret', 0);
    property(xml, 'PartialCapoStringFlags', 'Bitset', track.tuning.map(() => '0').join(''));
    if (track.tuning.length > 0) {
      xml.open('Property', { name: 'Tuning' });
      // Lowest string first, the model's order too.
      xml.text('Pitches', track.tuning.join(' '));
      xml.cdata('Label', '');
      xml.text('LabelVisible', 'false');
      xml.close('Property');
    }
  }
  xml.open('Property', { name: 'DiagramCollection' });
  xml.open('Items');
  plan.chords.forEach((chord, index) => {
    writeChordItem(xml, String(index), chord);
  });
  xml.close('Items');
  xml.close('Property');
  xml.close('Properties');
  xml.close('Staff');
  xml.close('Staves');
}

/** Every MIDI channel but 9, which General MIDI reserves for percussion. */
const MELODIC_CHANNELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12, 13, 14] as const;

/**
 * Two MIDI channels per track, as Guitar Pro assigns them (the second carries effects), and the
 * percussion channel for a drum kit; past seven melodic tracks the next port starts over.
 */
function midiChannels(
  index: number,
  drums: boolean,
): [port: number, primary: number, secondary: number] {
  if (drums) return [0, 9, 9];
  const pair = index % 7;
  return [
    Math.floor(index / 7),
    MELODIC_CHANNELS[pair * 2] ?? 0,
    MELODIC_CHANNELS[pair * 2 + 1] ?? 1,
  ];
}

const channelStrip = (track: Track): string => {
  // Parameters 11 and 12 are pan and volume, 0 to 1; the others are Guitar Pro's neutral settings.
  const values = Array.from({ length: 16 }, () => '0.5');
  values[9] = '1';
  values[11] = String(track.channel.pan / 127);
  values[12] = String(track.channel.volume / 127);
  return values.join(' ');
};

function color(hex: string): string {
  return [1, 3, 5]
    .map((start) => String(Number.parseInt(hex.slice(start, start + 2), 16)))
    .join(' ');
}

export interface TrackWriteContext {
  index: number;
  plan: TrackPlan;
  drums: number[];
  /** Whether any beat carries its own lyrics, in which case Guitar Pro must not lay the block again. */
  beatLyrics: boolean;
}

export function writeTrack(xml: XmlWriter, track: Track, context: TrackWriteContext): void {
  const { index, plan } = context;
  xml.open('Track', { id: String(index) });
  xml.cdata('Name', track.name);
  xml.cdata('ShortName', track.shortName);
  xml.text('Color', color(track.color));
  xml.text('PlayingStyle', 'Default');
  writeInstrumentSet(xml, track, context.drums);
  xml.open('Transpose');
  xml.text('Chromatic', 0);
  // Guitar Pro stores sounding minus written; the model keeps written minus sounding.
  xml.text('Octave', track.display.octaveShift === 0 ? 0 : -track.display.octaveShift);
  xml.close('Transpose');
  xml.open('RSE');
  xml.open('ChannelStrip', { version: 'E56' });
  xml.text('Parameters', channelStrip(track));
  xml.close('ChannelStrip');
  xml.close('RSE');
  xml.text('ForcedSound', -1);
  xml.open('Sounds');
  for (const entry of plan.sounds) {
    xml.open('Sound');
    xml.cdata('Name', entry.name);
    xml.cdata('Label', entry.name);
    xml.text('Path', entry.path);
    xml.text('Role', entry.role);
    xml.open('MIDI');
    xml.text('LSB', entry.bank & 127);
    xml.text('MSB', entry.bank >> 7);
    xml.text('Program', entry.program);
    xml.close('MIDI');
    xml.close('Sound');
  }
  xml.close('Sounds');
  const [port, primary, secondary] = midiChannels(index, track.kind === 'drums');
  xml.open('MidiConnection');
  xml.text('Port', port);
  xml.text('PrimaryChannel', primary);
  xml.text('SecondaryChannel', secondary);
  xml.text('ForeOneChannelPerString', 'false');
  xml.close('MidiConnection');
  xml.text('PlaybackState', track.channel.solo ? 'Solo' : track.channel.mute ? 'Mute' : 'Default');
  xml.text('AudioEngineState', 'MIDI');
  if (track.lyrics.length > 0) {
    // `dispatched` tells Guitar Pro the beats already carry the block's syllables.
    xml.open('Lyrics', context.beatLyrics ? { dispatched: 'true' } : undefined);
    for (const line of track.lyrics) {
      xml.open('Line');
      xml.cdata('Text', line.text);
      xml.text('Offset', line.startBar);
      xml.close('Line');
    }
    xml.close('Lyrics');
  }
  writeStaff(xml, track, plan);
  xml.open('Automations');
  for (const change of plan.soundChanges) {
    xml.open('Automation');
    xml.text('Type', 'Sound');
    xml.text('Linear', 'false');
    xml.text('Bar', change.bar);
    xml.text('Position', change.position);
    xml.text('Visible', 'true');
    xml.cdata('Value', soundKey(change.sound));
    xml.close('Automation');
  }
  xml.close('Automations');
  xml.close('Track');
}
