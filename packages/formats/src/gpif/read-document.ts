import type { GpifDocument } from './document';
import { childPath, isBlank, notModelled, unknownElement } from './elements';
import { GpifError } from './errors';
import { readBeat } from './read-beats';
import { readNote } from './read-notes';
import { readBar, readMasterBar, readRhythm, readVoice } from './read-structure';
import { emptyMeta, readMasterTrack, readScoreMeta, readTrack } from './read-tracks';
import type { WarningSink } from './warnings';
import type { XmlElement } from './xml';

/** Version stamps and the encoding label say nothing a reader needs once the XML is parsed. */
const SILENT_ROOT_CHILDREN = new Set(['GPVersion', 'GPRevision', 'Encoding']);

function collect<T>(
  sink: WarningSink,
  section: XmlElement,
  path: string,
  itemName: string,
  into: Map<string, T>,
  read: (sink: WarningSink, element: XmlElement, path: string) => T,
): void {
  for (const item of section.children) {
    const at = childPath(path, item);
    const id = item.attributes.get('id');
    if (item.name !== itemName || id === undefined) {
      unknownElement(sink, at);
      continue;
    }
    into.set(id, read(sink, item, at));
  }
}

/** Every section of a `GPIF` root, into id-keyed maps; nothing is resolved yet. */
export function readDocument(sink: WarningSink, root: XmlElement): GpifDocument {
  if (root.name !== 'GPIF') {
    throw new GpifError('not-gpif', `The root element is <${root.name}>, not <GPIF>`);
  }
  const document: GpifDocument = {
    meta: emptyMeta(),
    anacrusis: false,
    trackOrder: [],
    tempos: [],
    tracks: new Map(),
    masterBars: [],
    bars: new Map(),
    voices: new Map(),
    beats: new Map(),
    notes: new Map(),
    rhythms: new Map(),
  };

  for (const section of root.children) {
    const path = section.name;
    switch (section.name) {
      case 'Score':
        document.meta = readScoreMeta(sink, section, path);
        break;
      case 'MasterTrack': {
        const master = readMasterTrack(sink, section, path);
        document.trackOrder = master.trackOrder;
        document.tempos = master.tempos;
        document.anacrusis = master.anacrusis;
        break;
      }
      case 'Tracks':
        collect(sink, section, path, 'Track', document.tracks, readTrack);
        break;
      case 'MasterBars':
        for (const item of section.children) {
          const at = `${path}/MasterBar[${String(document.masterBars.length)}]`;
          if (item.name === 'MasterBar') document.masterBars.push(readMasterBar(sink, item, at));
          else unknownElement(sink, childPath(path, item));
        }
        break;
      case 'Bars':
        collect(sink, section, path, 'Bar', document.bars, readBar);
        break;
      case 'Voices':
        collect(sink, section, path, 'Voice', document.voices, readVoice);
        break;
      case 'Beats':
        collect(sink, section, path, 'Beat', document.beats, readBeat);
        break;
      case 'Notes':
        collect(sink, section, path, 'Note', document.notes, readNote);
        break;
      case 'Rhythms':
        collect(sink, section, path, 'Rhythm', document.rhythms, readRhythm);
        break;
      case 'AudioTracks':
        if (!isBlank(section)) notModelled(sink, path, 'An audio track');
        break;
      case 'BackingTrack':
      case 'Assets':
        notModelled(sink, path, 'A backing track');
        break;
      case 'ScoreViews':
        notModelled(sink, path, 'Score views');
        break;
      default:
        if (!SILENT_ROOT_CHILDREN.has(section.name)) unknownElement(sink, path);
    }
  }
  return document;
}
