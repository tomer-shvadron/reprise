import { MIDI_MAX, STANDARD_TUNING, createTrack } from '@reprise/model';
import type { Clef, Notation, Track, TrackKind } from '@reprise/model';

import { hasFlag } from '../binary/binary-reader';
import { controllerValue, invalid } from './context';
import type { Context } from './context';
import type { Header, MidiChannel } from './header';

export interface TrackInfo {
  track: Track;
  /** Open strings as the file lists them, string 1 (the highest) first. */
  gpTuning: number[];
  offset: number;
}

/** MIDI channel 10, 0-based: General MIDI's percussion channel. */
const PERCUSSION_CHANNEL = 9;
/** Below B1 Guitar Pro 3 to 6 draws the standard staff in the bass clef. */
const BASS_CLEF_BELOW = 35;
/** A GP5 track setting whose value 12 means the bass clef, whatever the tuning. */
const GP5_BASS_CLEF = 12;
const MAX_GP_STRINGS = 7;

/** Guitars and basses (GM 24 to 39), then sitar, banjo, shamisen and koto. */
export function isFrettedProgram(program: number): boolean {
  return (program >= 24 && program <= 39) || (program >= 104 && program <= 107);
}

function shortNameOf(name: string): string {
  return name.length <= 5 ? name : `${name.slice(0, 4).trimEnd()}.`;
}

export function readTrack(context: Context, header: Header, index: number): TrackInfo {
  const { reader, version, log } = context;
  const offset = reader.offset;
  const location = { offset, track: index };
  const flags = reader.byte();
  const name = reader.fixedString(40);

  const stringCount = reader.int();
  const gpTuning: number[] = [];
  for (let i = 0; i < MAX_GP_STRINGS; i++) {
    const pitch = reader.int();
    if (i < stringCount) gpTuning.push(pitch);
  }
  const port = reader.int();
  const channelIndex = reader.int() - 1;
  const effectChannel = reader.int() - 1;
  const fretCountOffset = reader.offset;
  const fretCount = reader.int();
  const capoOffset = reader.offset;
  const capo = reader.int();
  const color = reader.color();

  // GP5 marks a track shown in the multi-track view with 0x08; the others are GP3 to GP5 flags.
  const hidden = version >= 500 && !hasFlag(flags, 0x08);
  if (hidden || hasFlag(flags, 0x02) || hasFlag(flags, 0x04) || hasFlag(flags, 0x80)) {
    log.info(
      'track-flags-dropped',
      '12-string, banjo, tuning-display or hidden-from-multitrack flags',
      location,
    );
  }
  log.info(
    'midi-routing-dropped',
    `MIDI port ${String(port)}, channel ${String(channelIndex + 1)} and effect channel ${String(effectChannel + 1)}`,
    location,
  );

  let channel: MidiChannel | undefined = header.channels[channelIndex];
  if (!channel) {
    invalid(context, location, 'MIDI channel', channelIndex + 1, 1);
    channel = header.channels[0];
  }
  const drums = hasFlag(flags, 0x01) || channelIndex === PERCUSSION_CHANNEL;
  const program = channel?.program ?? 0;
  const kind: TrackKind = drums ? 'drums' : isFrettedProgram(program) ? 'fretted' : 'pitched';

  let notation: Notation | undefined;
  let bank = 0;
  let bassClefSetting = false;
  if (version >= 500) {
    const staffFlags = reader.byte();
    const tab = hasFlag(staffFlags, 0x01);
    const standard = hasFlag(staffFlags, 0x02);
    notation = tab && standard ? 'both' : tab ? 'tab' : standard ? 'standard' : undefined;
    // Auto-accentuation, an RSE setting.
    reader.skip(1);
    // The channel's MIDI bank change, then a byte the RSE dialog writes.
    reader.skip(1);
    bank = reader.byte();
    reader.skip(1);
    bassClefSetting = reader.int() === GP5_BASS_CLEF;
    log.info(
      'rse-dropped',
      'RSE track settings: humanize, instrument, effects and equalizer',
      location,
    );
    // Two more RSE ints, ten bytes of RSE options, two bytes, and the RSE instrument bank.
    reader.skip(4 + 4 + 10 + 1 + 1 + 16);
    if (version >= 510) {
      reader.skip(4);
      reader.intByteString('int');
      reader.intByteString('int');
    }
  }

  const tuning = sanitiseTuning(context, location, gpTuning, kind);
  const lowest = Math.min(...tuning);
  const clef: Clef =
    kind === 'drums'
      ? 'percussion'
      : bassClefSetting || lowest < BASS_CLEF_BELOW
        ? 'bass'
        : 'treble';

  const track = createTrack(kind, {
    name,
    shortName: shortNameOf(name),
    color,
    program: Math.min(MIDI_MAX, Math.max(0, program)),
    bank,
    bars: [],
  });
  if (program < 0 || program > MIDI_MAX) {
    invalid(context, location, 'program', program, track.program);
  }
  if (channel) {
    const scale = (raw: number, what: string): number =>
      controllerValue(context, raw, what, location);
    track.channel = {
      volume: scale(channel.volume, 'channel volume'),
      pan: scale(channel.pan, 'channel pan'),
      chorus: scale(channel.chorus, 'channel chorus'),
      reverb: scale(channel.reverb, 'channel reverb'),
      phaser: scale(channel.phaser, 'channel phaser'),
      tremolo: scale(channel.tremolo, 'channel tremolo'),
      mute: hasFlag(flags, 0x20),
      solo: hasFlag(flags, 0x10),
    };
  }
  track.display.clef = clef;

  if (kind !== 'drums') {
    track.tuning = tuning;
    if (fretCount >= 1 && fretCount <= MIDI_MAX) track.fretCount = fretCount;
    else invalid(context, { ...location, offset: fretCountOffset }, 'fret count', fretCount, 24);
    if (capo >= 0 && capo <= MIDI_MAX) track.capo = capo;
    else invalid(context, { ...location, offset: capoOffset }, 'capo', capo, 0);
  }
  if (kind === 'fretted' && notation) track.display.notation = notation;
  if (kind !== 'fretted' && notation === 'tab') {
    log.info('track-flags-dropped', 'tablature display on a track without frets', location);
  }
  return { track, gpTuning, offset };
}

/** `Track.tuning` runs lowest string first; the file lists string 1, the highest, first. */
function sanitiseTuning(
  context: Context,
  location: { offset: number; track: number },
  gpTuning: number[],
  kind: TrackKind,
): number[] {
  if (gpTuning.length === 0) {
    if (kind !== 'drums') invalid(context, location, 'string count', 0, STANDARD_TUNING.length);
    return [...STANDARD_TUNING];
  }
  return gpTuning
    .map((pitch) => {
      if (pitch >= 0 && pitch <= MIDI_MAX) return pitch;
      const clamped = Math.min(MIDI_MAX, Math.max(0, pitch));
      if (kind !== 'drums') invalid(context, location, 'string tuning', pitch, clamped);
      return clamped;
    })
    .reverse();
}
