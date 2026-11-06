import type { GpifDocument, GpifNote } from '../gpif/document';
import type { WarningSink } from '../gpif/warnings';

/**
 * Guitar Pro 6's drum kit: a note names a kit piece (`Element`, the index here) and a way of
 * striking it (`Variation`), and the General MIDI percussion note each pair plays. GP6 writes no
 * `InstrumentArticulation`, and its `Midi` number is an input number like GP7's, past GM's range
 * for a variant (91 for a snare rim shot), so the pair is the only reliable sound. The sounds
 * are those alphaTab 1.8.4 assigns (its `PercussionMapper`), the oracle the fixtures are checked
 * against; a variant without its own GM note plays the piece's sound.
 */
const GP6_KIT: readonly (readonly [name: string, variations: readonly number[]])[] = [
  ['kick', [35, 35, 35]],
  ['snare: hit, rim shot, side stick', [38, 38, 37]],
  ['low cowbell', [56, 56, 56]],
  ['medium cowbell', [56, 56, 56]],
  ['high cowbell', [56, 56, 56]],
  ['very low tom', [43, 43, 43]],
  ['low tom', [45, 45, 45]],
  ['medium tom', [47, 47, 47]],
  ['high tom', [48, 48, 48]],
  ['very high tom', [50, 50, 50]],
  ['hi-hat: closed, half open, open', [42, 46, 46]],
  ['pedal hi-hat', [44, 44, 44]],
  ['medium crash: hit, choke', [57, 57, 57]],
  ['high crash: hit, choke', [49, 49, 49]],
  ['splash: hit, choke', [55, 55, 55]],
  ['ride: middle, edge, bell', [51, 51, 59]],
  ['china: hit, choke', [52, 52, 52]],
];

/** The GM percussion note of a GP6 kit piece and variation, or undefined for an unknown pair. */
export function gp6DrumSound(element: number, variation: number): number | undefined {
  return GP6_KIT[element]?.[1][variation];
}

/** Each drum track's notes, through the master bars, bars, voices and beats that reach them. */
function drumNotes(document: GpifDocument): Map<string, Set<GpifNote>> {
  const order = document.trackOrder.length > 0 ? document.trackOrder : [...document.tracks.keys()];
  const tracks = order.flatMap((id) => {
    const track = document.tracks.get(id);
    return track ? [track] : [];
  });
  const byTrack = new Map<string, Set<GpifNote>>();
  for (const masterBar of document.masterBars) {
    let cursor = 0;
    for (const track of tracks) {
      // A track takes one bar id per staff, as the score builder distributes them.
      const staves = Math.max(1, track.staves.length);
      const barIds = masterBar.barIds.slice(cursor, cursor + staves);
      cursor += staves;
      if (!track.drums) continue;
      let notes = byTrack.get(track.id);
      if (!notes) byTrack.set(track.id, (notes = new Set()));
      for (const barId of barIds) {
        for (const voiceId of document.bars.get(barId)?.voiceIds ?? []) {
          for (const beatId of document.voices.get(voiceId)?.beatIds ?? []) {
            for (const noteId of document.beats.get(beatId)?.noteIds ?? []) {
              const note = document.notes.get(noteId);
              if (note) notes.add(note);
            }
          }
        }
      }
    }
  }
  return byTrack;
}

/**
 * A GP6 drum note with no `InstrumentArticulation` takes its sound from `Element` and
 * `Variation`. A variant that sounds as its piece is reported once per track as
 * `drum-articulation`, as the GP7 reader does; a pair outside the kit is reported once per track
 * and the note keeps its `Midi` number.
 */
export function mapGp6DrumNotes(document: GpifDocument, sink: WarningSink): void {
  for (const [trackId, notes] of drumNotes(document)) {
    for (const note of notes) {
      if (note.articulation !== undefined || note.drumElement === undefined) continue;
      const variation = note.drumVariation ?? 0;
      const sound = gp6DrumSound(note.drumElement, variation);
      if (sound === undefined) {
        sink.warn(
          'unknown-value',
          note.path,
          `GP6 drum element ${String(note.drumElement)} with variation ${String(variation)} is not a Guitar Pro 6 kit piece; the note keeps its MIDI number`,
          `gp6-drum:${trackId}`,
        );
        continue;
      }
      if (variation !== 0 && note.midi !== undefined && note.midi !== sound) {
        sink.warn(
          'drum-articulation',
          note.path,
          `Drum articulation variants play as their base sound (GP6 element ${String(note.drumElement)}, variation ${String(variation)} as MIDI ${String(sound)}); the variant is not modelled`,
          trackId,
        );
      }
      note.midi = sound;
    }
  }
}
