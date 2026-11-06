import type { Accidental } from '@reprise/model';

import { childPath, notModelled, unknownValue } from '../gpif/elements';
import type { GpifVersionHooks } from '../gpif/read-gpif';
import type { WarningSink } from '../gpif/warnings';
import type { XmlElement } from '../gpif/xml';
import { mapGp6DrumNotes } from './gp6-drums';

/** GP6 spells a note's accidental as a word on the note; GP7 moved it into `ConcertPitch`. */
const GP6_ACCIDENTALS: Readonly<Record<string, Accidental>> = {
  natural: 'natural',
  sharp: 'sharp',
  flat: 'flat',
  doublesharp: 'doubleSharp',
  doubleflat: 'doubleFlat',
};

/** Removes the children `match` accepts, calling `each` with each one and its warning path. */
function take(
  parent: XmlElement,
  path: string,
  match: (node: XmlElement) => boolean,
  each: (node: XmlElement, at: string) => void,
): void {
  for (let index = parent.children.length - 1; index >= 0; index--) {
    const node = parent.children[index];
    if (!node || !match(node)) continue;
    parent.children.splice(index, 1);
    each(node, childPath(path, node));
  }
}

const named = (name: string) => (node: XmlElement) => node.name === name;

const sections = (root: XmlElement, name: string): XmlElement[] =>
  root.children.filter((section) => section.name === name);

/**
 * Guitar Pro 6's gpif, against the GP7 vocabulary the shared reader knows. Most GP6 forms are
 * read there already (track-level `Properties`, `GeneralMidi`, `Octave`/`Tone` pitches, the
 * `Whammy` element); these are the ones found only in GP6 files:
 *
 * - `Note/Accidental` (`Flat`, `Sharp`, ...) becomes the note's accidental unless a
 *   `ConcertPitch` property already spells it.
 * - `Beat/Bank` selects an RSE sound bank, part of the RSE setup the reader drops.
 * - the track-level `AutoBrush` property is the GP7 track element of the same name.
 * - drum notes carry `Element` and `Variation` instead of `InstrumentArticulation`.
 *
 * Hooks are made per read, since the XML pass hands the accidentals to the document pass.
 */
export function gp6Hooks(): GpifVersionHooks {
  const accidentals = new Map<string, Accidental>();

  const beforeRead = (root: XmlElement, sink: WarningSink): void => {
    for (const tracks of sections(root, 'Tracks')) {
      for (const track of tracks.children) {
        const trackPath = childPath('Tracks', track);
        for (const properties of track.children.filter(named('Properties'))) {
          take(
            properties,
            childPath(trackPath, properties),
            (property) => property.attributes.get('name') === 'AutoBrush',
            (_, at) => {
              notModelled(sink, at, 'Automatic brush');
            },
          );
        }
      }
    }
    for (const beats of sections(root, 'Beats')) {
      for (const beat of beats.children) {
        take(beat, childPath('Beats', beat), named('Bank'), (_, at) => {
          notModelled(sink, at, 'An RSE sound bank change');
        });
      }
    }
    for (const notes of sections(root, 'Notes')) {
      for (const note of notes.children) {
        const id = note.attributes.get('id');
        take(note, childPath('Notes', note), named('Accidental'), (node, at) => {
          const text = node.text.trim();
          const accidental = GP6_ACCIDENTALS[text.toLowerCase()];
          if (accidental === undefined) unknownValue(sink, at, text);
          else if (id !== undefined) accidentals.set(id, accidental);
        });
      }
    }
  };

  return {
    beforeRead,
    afterRead: (document, sink) => {
      for (const [id, accidental] of accidentals) {
        const note = document.notes.get(id);
        if (note && note.accidental === undefined) note.accidental = accidental;
      }
      mapGp6DrumNotes(document, sink);
    },
  };
}
