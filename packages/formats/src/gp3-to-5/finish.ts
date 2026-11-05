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
    resolveTies(context, slots, trackIndex);
    moveHammerFlags(context, slots, trackIndex);
  }
  if (track.kind !== 'fretted') toMidi(context, track, trackIndex);
  if (track.kind !== 'drums') swapAccidentals(context, track, masterBars);
}

/** How many bars back or forward a tie origin or hammer-on destination is looked for. */
const SAME_STRING_SEARCH_BARS = 3;

/**
 * Guitar Pro ties a note to the last note on its string even when the beats between do not use
 * that string. The model only ties to the previous beat, so a farther origin still lends its
 * fret but the tie is released and reported.
 */
function resolveTies(context: Context, slots: Slot[], trackIndex: number): void {
  slots.forEach((slot, s) => {
    for (const note of slot.beat.notes) {
      if (!note.tie) continue;
      let origin: Note | undefined;
      let distance = 0;
      for (let back = s - 1; back >= 0 && !origin; back--) {
        const earlier = slots[back];
        if (!earlier || earlier.bar < slot.bar - SAME_STRING_SEARCH_BARS) break;
        origin = earlier.beat.notes.find((n) => n.string === note.string);
        distance = s - back;
      }
      if (origin) note.fret = origin.fret;
      if (origin && distance === 1) continue;
      note.tie = false;
      if (origin) {
        context.log.warn(
          'tie-beyond-previous-beat',
          `a tied note on string ${String(note.string)} continues a note ${String(distance)} beats back; the model ties only to the previous beat, so it is played at that note's fret`,
          locationOf(context, note, slot, trackIndex),
        );
      } else {
        context.log.warn(
          'tie-without-origin',
          `a tied note on string ${String(note.string)} has no note to continue; it is played instead`,
          locationOf(context, note, slot, trackIndex),
        );
      }
    }
  });
}

function moveHammerFlags(context: Context, slots: Slot[], trackIndex: number): void {
  slots.forEach((slot, s) => {
    for (const note of slot.beat.notes) {
      if (!context.noteFacts.get(note)?.hammerOrigin) continue;
      let destination: Note | undefined;
      for (let next = s + 1; next < slots.length && !destination; next++) {
        const later = slots[next];
        if (!later || later.beat.rest || later.bar > slot.bar + SAME_STRING_SEARCH_BARS) break;
        destination = later.beat.notes.find((n) => n.string === note.string);
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
