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
    drops.drop(
      'capo',
      [...path, 'capo'],
      'A capo off a fretted track is lost: the notes are fingered without one, and Guitar Pro would sound them a capo higher',
    );
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

export interface DrumArticulation {
  midi: number;
  name: string;
  /** Guitar Pro's RSE sound for the articulation; empty where it has none. */
  sound: string;
}

export interface DrumElement {
  name: string;
  type: string;
  soundbank: string;
  articulations: DrumArticulation[];
}

type KitEntry = readonly [
  name: string,
  type: string,
  soundbank: string,
  articulations: readonly (readonly [midi: number, name: string, sound: string])[],
];

/**
 * Guitar Pro 7's drum kit in its own element order: the element each GM2 sound belongs to, with
 * the articulation name and RSE sound Guitar Pro gives it (alphaTab's `GpifSoundMapper` lists the
 * same kit for its exports). The GM2 sounds Guitar Pro has no element for (27, 28, 32) and any
 * other note a track plays go in a trailing unpitched element.
 */
const DRUM_KIT: readonly KitEntry[] = [
  [
    'Snare',
    'snare',
    'Master-Snare',
    [
      [38, 'Snare (hit)', 'stick.hit.hit'],
      [37, 'Snare (side stick)', 'stick.hit.sidestick'],
    ],
  ],
  [
    'Charley',
    'hiHat',
    'Master-Hihat',
    [
      [42, 'Hi-Hat (closed)', 'stick.hit.closed'],
      [46, 'Hi-Hat (open)', 'stick.hit.open'],
      [44, 'Pedal Hi-Hat (hit)', 'pedal.hit.pedal'],
    ],
  ],
  ['Acoustic Kick Drum', 'kickDrum', 'AcousticKick-Percu', [[35, 'Kick (hit)', 'pedal.hit.hit']]],
  ['Kick Drum', 'kickDrum', 'Master-Kick', [[36, 'Kick (hit)', 'pedal.hit.hit']]],
  ['Tom Very High', 'tom', 'Master-Tom05', [[50, 'High Floor Tom (hit)', 'stick.hit.hit']]],
  ['Tom High', 'tom', 'Master-Tom04', [[48, 'High Tom (hit)', 'stick.hit.hit']]],
  ['Tom Medium', 'tom', 'Master-Tom03', [[47, 'Mid Tom (hit)', 'stick.hit.hit']]],
  ['Tom Low', 'tom', 'Master-Tom02', [[45, 'Low Tom (hit)', 'stick.hit.hit']]],
  ['Tom Very Low', 'tom', 'Master-Tom01', [[43, 'Very Low Tom (hit)', 'stick.hit.hit']]],
  [
    'Ride',
    'ride',
    'Master-Ride',
    [
      [51, 'Ride (middle)', 'stick.hit.mid'],
      [53, 'Ride (bell)', 'stick.hit.bell'],
    ],
  ],
  ['Splash', 'splash', 'Master-Splash', [[55, 'Splash (hit)', 'stick.hit.hit']]],
  ['China', 'china', 'Master-China', [[52, 'China (hit)', 'stick.hit.hit']]],
  ['Crash High', 'crash', 'Master-Crash02', [[49, 'Crash high (hit)', 'stick.hit.hit']]],
  ['Crash Medium', 'crash', 'Master-Crash01', [[57, 'Crash medium (hit)', 'stick.hit.hit']]],
  [
    'Cowbell Medium',
    'cowbell',
    'CowbellMid-Percu',
    [[56, 'Cowbell medium (hit)', 'stick.hit.hit']],
  ],
  [
    'Woodblock Low',
    'woodblock',
    'WoodblockLow-Percu',
    [[77, 'Woodblock low (hit)', 'stick.hit.hit']],
  ],
  [
    'Woodblock High',
    'woodblock',
    'WoodblockHigh-Percu',
    [[76, 'Woodblock high (hit)', 'stick.hit.hit']],
  ],
  ['Bongo High', 'bongo', 'BongoHigh-Percu', [[60, 'Bongo High (hit)', 'hand.hit.hit']]],
  ['Bongo Low', 'bongo', 'BongoLow-Percu', [[61, 'Bongo Low (hit)', 'hand.hit.hit']]],
  ['Timbale Low', 'timbale', 'TimbaleLow-Percu', [[66, 'Timbale low (hit)', 'stick.hit.hit']]],
  ['Timbale High', 'timbale', 'TimbaleHigh-Percu', [[65, 'Timbale high (hit)', 'stick.hit.hit']]],
  ['Agogo Low', 'agogo', 'AgogoLow-Percu', [[68, 'Agogo low (hit)', 'stick.hit.hit']]],
  ['Agogo High', 'agogo', 'AgogoHigh-Percu', [[67, 'Agogo high (hit)', 'stick.hit.hit']]],
  ['Conga Low', 'conga', 'CongaLow-Percu', [[64, 'Conga low (hit)', 'hand.hit.hit']]],
  [
    'Conga High',
    'conga',
    'CongaHigh-Percu',
    [
      [63, 'Conga high (hit)', 'hand.hit.hit'],
      [62, 'Conga high (mute)', 'hand.hit.mute'],
    ],
  ],
  ['Whistle Low', 'whistle', 'WhistleLow-Percu', [[72, 'Whistle low (hit)', 'blow.hit.hit']]],
  ['Whistle High', 'whistle', 'WhistleHigh-Percu', [[71, 'Whistle high (hit)', 'blow.hit.hit']]],
  [
    'Guiro',
    'guiro',
    'Guiro-Percu',
    [
      [73, 'Guiro (hit)', 'stick.hit.hit'],
      [74, 'Guiro (scrap-return)', 'stick.scrape.return'],
    ],
  ],
  [
    'Surdo',
    'surdo',
    'Surdo-Percu',
    [
      [86, 'Surdo (hit)', 'brush.hit.hit'],
      [87, 'Surdo (mute)', 'brush.hit.mute'],
    ],
  ],
  ['Tambourine', 'tambourine', 'Tambourine-Percu', [[54, 'Tambourine (hit)', 'hand.hit.hit']]],
  [
    'Cuica',
    'cuica',
    'Cuica-Percu',
    [
      [79, 'Cuica (open)', 'hand.hit.hit'],
      [78, 'Cuica (mute)', 'hand.hit.mute'],
    ],
  ],
  ['Vibraslap', 'vibraslap', 'Vibraslap-Percu', [[58, 'Vibraslap (hit)', 'hand.hit.hit']]],
  [
    'Triangle',
    'triangle',
    'Triangle-Percu',
    [
      [81, 'Triangle (hit)', 'stick.hit.hit'],
      [80, 'Triangle (mute)', 'stick.hit.mute'],
    ],
  ],
  ['Cabasa', 'cabasa', 'Cabasa-Percu', [[69, 'Cabasa (hit)', 'hand.hit.hit']]],
  ['Castanets', 'castanets', 'Castanets-Percu', [[85, 'Castanets (hit)', 'hand.hit.hit']]],
  ['Claves', 'claves', 'Claves-Percu', [[75, 'Claves (hit)', 'stick.hit.hit']]],
  ['Left Maraca', 'maraca', 'Maracas-Percu', [[70, 'Left Maraca (hit)', 'hand.hit.hit']]],
  ['Shaker', 'shaker', 'ShakerStudio-Percu', [[82, 'Shaker (hit)', 'hand.hit.hit']]],
  ['Bell Tree', 'bellTree', 'BellTree-Percu', [[84, 'Bell Tree (hit)', 'stick.hit.hit']]],
  ['Jingle Bell', 'jingleBell', 'JingleBell-Percu', [[83, 'Jingle Bell (hit)', 'stick.hit.hit']]],
  ['Hand Clap', 'handClap', 'GroupHandClap-Percu', [[39, 'Hand Clap (hit)', 'hand.hit.hit']]],
  [
    'Electric Snare',
    'snare',
    'ElectricSnare-Percu',
    [[40, 'Electric Snare (hit)', 'stick.hit.hit']],
  ],
  ['Sticks', 'snare', 'Stick-Percu', [[31, 'Snare (side stick)', 'stick.hit.sidestick']]],
  [
    'Very Low Floor Tom',
    'tom',
    'LowFloorTom-Percu',
    [[41, 'Low Floor Tom (hit)', 'stick.hit.hit']],
  ],
  [
    'Ride Cymbal 2',
    'ride',
    'Ride-Percu',
    [
      [59, 'Ride (edge)', 'stick.hit.edge'],
      [29, 'Ride (choke)', 'stick.hit.choke'],
    ],
  ],
  ['Reverse Cymbal', 'crash', 'Reverse-Cymbal', [[30, 'Reverse Cymbal (hit)', 'stick.hit.hit']]],
  [
    'Metronome',
    'snare',
    'Metronome-Percu',
    [
      [33, 'Metronome (hit)', 'stick.hit.sidestick'],
      [34, 'Metronome (bell)', 'stick.hit.hit'],
    ],
  ],
];

const PERCUSSION_BY_MIDI = new Map(
  PERCUSSION_INSTRUMENTS.map((instrument) => [instrument.midi, instrument]),
);

/** A drum track's instrument set: Guitar Pro's kit, then whatever else the track plays. */
export function drumKit(track: Track): DrumElement[] {
  const elements: DrumElement[] = DRUM_KIT.map(([name, type, soundbank, articulations]) => ({
    name,
    type,
    soundbank,
    articulations: articulations.map(([midi, label, sound]) => ({ midi, name: label, sound })),
  }));
  const known = new Set(elements.flatMap((element) => element.articulations.map((a) => a.midi)));
  const others = new Set(
    PERCUSSION_INSTRUMENTS.map((instrument) => instrument.midi).filter((midi) => !known.has(midi)),
  );
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of [...beat.notes, ...(beat.grace ?? []).flatMap((g) => g.notes)]) {
          if (!known.has(note.fret)) others.add(note.fret);
        }
      }
    }
  }
  if (others.size > 0) {
    elements.push({
      name: 'Percussion',
      type: 'unpitched',
      soundbank: '',
      articulations: [...others]
        .sort((a, b) => a - b)
        .map((midi) => ({
          midi,
          name: PERCUSSION_BY_MIDI.get(midi)?.name ?? `MIDI ${String(midi)}`,
          sound: '',
        })),
    });
  }
  return elements;
}

/** Every articulation's MIDI note in document order, which is what notes index. */
export function drumArticulations(kit: readonly DrumElement[]): number[] {
  return kit.flatMap((element) => element.articulations.map((a) => a.midi));
}

const NOTEHEADS: Readonly<Record<NoteHead, string>> = {
  normal: 'noteheadBlack noteheadHalf noteheadWhole',
  cross: 'noteheadXBlack noteheadXBlack noteheadXBlack',
  diamond: 'noteheadDiamondWhite noteheadDiamondWhite noteheadDiamondWhite',
  triangle: 'noteheadTriangleUpBlack noteheadTriangleUpHalf noteheadTriangleUpWhole',
};

/** The five-line staff's top line is gpif's line 0 and its bottom line 8; the model counts up from the bottom. */
const BOTTOM_STAFF_LINE = 8;

function articulation(
  xml: XmlWriter,
  name: string,
  line: number,
  heads: string,
  midi: number,
  sound: string,
): void {
  xml.open('Articulation');
  xml.text('Name', name);
  xml.text('StaffLine', line);
  xml.text('Noteheads', heads);
  xml.text('TechniquePlacement', 'outside');
  xml.text('TechniqueSymbol', '');
  xml.text('InputMidiNumbers', midi === 0 ? '' : midi);
  xml.text('OutputRSESound', sound);
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
 * The instrument set: a drum kit's elements with their articulations (notes index them across
 * elements, and the reader plays each as its `OutputMidiNumber`); any other track has Guitar
 * Pro's single `Pitched` element.
 */
function writeInstrumentSet(xml: XmlWriter, track: Track, kit: readonly DrumElement[]): void {
  const [name, type] = instrumentSet(track);
  xml.open('InstrumentSet');
  xml.text('Name', name);
  xml.text('Type', type);
  xml.text('LineCount', 5);
  xml.open('Elements');
  const elements: readonly DrumElement[] =
    track.kind === 'drums'
      ? kit
      : [
          {
            name: 'Pitched',
            type: 'pitched',
            soundbank: '',
            articulations: [{ midi: 0, name: '', sound: '' }],
          },
        ];
  for (const element of elements) {
    xml.open('Element');
    xml.text('Name', element.name);
    xml.text('Type', element.type);
    xml.text('SoundbankName', element.soundbank);
    xml.open('Articulations');
    for (const { midi, name: label, sound } of element.articulations) {
      const instrument = PERCUSSION_BY_MIDI.get(midi);
      articulation(
        xml,
        label,
        track.kind === 'drums' ? BOTTOM_STAFF_LINE - (instrument?.staffPosition ?? 4) : 0,
        NOTEHEADS[instrument?.noteHead ?? 'normal'],
        midi,
        sound,
      );
    }
    xml.close('Articulations');
    xml.close('Element');
  }
  xml.close('Elements');
  xml.close('InstrumentSet');
}

const DIAGRAM_FINGERS: Readonly<Record<Finger, string>> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  // Guitar Pro's own spelling; alphaTab's writer says `Ring`, which its parser does not read back.
  ring: 'Rank',
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

/** Guitar Pro's neck for a staff the model gives none (a drum kit). */
const DEFAULT_FRET_COUNT = 24;

/** The `Instrument` Guitar Pro names a tuning with; the reader reads it silently. */
function tuningInstrument(track: Track): string {
  if (track.program === 105) return 'Banjo';
  if (track.program >= 32 && track.program <= 39) return 'Bass';
  return 'Guitar';
}

function writeStaff(xml: XmlWriter, track: Track, plan: TrackPlan): void {
  xml.open('Staves');
  xml.open('Staff');
  xml.open('Properties');
  property(xml, 'CapoFret', 'Fret', track.kind === 'fretted' ? track.capo : 0);
  property(
    xml,
    'FretCount',
    'Number',
    track.kind === 'drums' ? DEFAULT_FRET_COUNT : track.fretCount,
  );
  property(xml, 'PartialCapoFret', 'Fret', 0);
  property(xml, 'PartialCapoStringFlags', 'Bitset', track.tuning.map(() => '0').join(''));
  if (track.tuning.length > 0) {
    xml.open('Property', { name: 'Tuning' });
    // Lowest string first, the model's order too.
    xml.text('Pitches', track.tuning.join(' '));
    xml.text('Instrument', tuningInstrument(track));
    xml.cdata('Label', '');
    xml.text('LabelVisible', 'false');
    xml.close('Property');
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
  kit: readonly DrumElement[];
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
  writeInstrumentSet(xml, track, context.kit);
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
