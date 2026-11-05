import { MIDI_MAX, respell } from '@reprise/model';
import type { Beat, KeySignature, MasterBar, Note, Track } from '@reprise/model';

import type { WarningLocation } from '../warnings';
import type { Context } from './context';
import type { TrackInfo } from './tracks';

interface Slot {
  bar: number;
  voice: number;
  index: number;
  beat: Beat;
}

/**
 * Resolves what needs the whole track: tied notes take their origin's fret (GP often stores 0),
 * hammer-on flags move from origin to destination, drum and pitched notes become MIDI values,
 * and GP5's swapped accidentals become an explicit spelling.
 */
export function finishTrack(
  context: Context,
  info: TrackInfo,
  masterBars: readonly MasterBar[],
  trackIndex: number,
): void {
  const { track } = info;
  for (let voice = 0; voice < 4; voice++) {
    const slots: Slot[] = [];
    track.bars.forEach((bar, b) => {
      bar.voices[voice]?.beats.forEach((beat, index) => slots.push({ bar: b, voice, index, beat }));
    });
    resolveTies(context, track, slots, trackIndex);
    moveHammerFlags(context, slots, trackIndex);
  }
  if (track.kind !== 'fretted') toMidi(context, track, trackIndex);
  if (track.kind !== 'drums') swapAccidentals(context, track, masterBars);
}

/** The beat `validateScore` pairs a tie with: the previous one in the voice, into the bar before. */
function previousOf(track: Track, slot: Slot): Beat | undefined {
  const { bar, voice, index } = slot;
  if (index > 0) return track.bars[bar]?.voices[voice]?.beats[index - 1];
  return track.bars[bar - 1]?.voices[voice]?.beats.at(-1);
}

function resolveTies(context: Context, track: Track, slots: Slot[], trackIndex: number): void {
  for (const slot of slots) {
    for (const note of slot.beat.notes) {
      if (!note.tie) continue;
      const previous = previousOf(track, slot);
      const origin =
        previous && !previous.rest
          ? previous.notes.find((n) => n.string === note.string)
          : undefined;
      if (origin) {
        note.fret = origin.fret;
        continue;
      }
      note.tie = false;
      context.log.warn(
        'tie-without-origin',
        `a tied note on string ${String(note.string)} has no note to continue in the previous beat; it is played instead`,
        locationOf(context, note, slot, trackIndex),
      );
    }
  }
}

function moveHammerFlags(context: Context, slots: Slot[], trackIndex: number): void {
  slots.forEach((slot, s) => {
    for (const note of slot.beat.notes) {
      if (!context.noteFacts.get(note)?.hammerOrigin) continue;
      let destination: Note | undefined;
      for (let next = s + 1; next < slots.length && !destination; next++) {
        const beat = slots[next]?.beat;
        if (!beat || beat.rest) break;
        destination = beat.notes.find((n) => n.string === note.string);
      }
      if (destination) {
        destination.hammerPull = true;
        continue;
      }
      context.log.warn(
        'hammer-pull-without-destination',
        `a hammer-on or pull-off from string ${String(note.string)} has no following note on that string`,
        locationOf(context, note, slot, trackIndex),
      );
    }
  });
}

function locationOf(context: Context, note: Note, slot: Slot, track: number): WarningLocation {
  const offset = context.noteFacts.get(note)?.offset;
  return {
    ...(offset === undefined ? {} : { offset }),
    track,
    bar: slot.bar,
    voice: slot.voice,
    beat: slot.index,
  };
}

function eachNote(track: Track, visit: (note: Note, beat: Beat, bar: number) => void): void {
  track.bars.forEach((bar, b) => {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        for (const note of beat.notes) visit(note, beat, b);
        for (const grace of beat.grace ?? []) for (const note of grace.notes) visit(note, beat, b);
      }
    }
  });
}

/**
 * Drum notes keep their fret byte, which already is the GM percussion note. Pitched notes were
 * written on strings, so their MIDI value is the open string plus capo plus fret, which is what
 * `Track.tuning` and `capo` let gp5 export reverse.
 */
function toMidi(context: Context, track: Track, trackIndex: number): void {
  const pitchOf = (string: number, fret: number): number => {
    if (track.kind === 'drums') return fret;
    return (track.tuning[track.tuning.length - string] ?? 0) + track.capo + fret;
  };
  eachNote(track, (note, _beat, bar) => {
    const midi = pitchOf(note.string, note.fret);
    if (note.trill) note.trill.fret = Math.min(MIDI_MAX, pitchOf(note.string, note.trill.fret));
    note.string = 0;
    note.fret = Math.min(MIDI_MAX, midi);
    if (midi > MIDI_MAX) {
      context.log.warn('invalid-value', `MIDI note ${String(midi)} is out of range; read as 127`, {
        track: trackIndex,
        bar,
      });
    }
  });
}

function swapAccidentals(context: Context, track: Track, masterBars: readonly MasterBar[]): void {
  const defaultKey: KeySignature = { fifths: 0, minor: false };
  track.bars.forEach((bar, b) => {
    const key = masterBars[b]?.keySignature ?? defaultKey;
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        beat.notes = beat.notes.map((note) =>
          context.noteFacts.get(note)?.swapAccidentals ? respell(track, note, key) : note,
        );
      }
    }
  });
}
