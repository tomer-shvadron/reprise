import type { Chord, LyricLine, TempoUnit } from '@reprise/model';

import type { GpifMeta, GpifStaff, GpifTempo, GpifTrack, GpifTrackAutomation } from './document';
import {
  child,
  childPath,
  childText,
  isBlank,
  notModelled,
  parseBool,
  parseFloatOr,
  parseIntOr,
  splitList,
  unknownElement,
} from './elements';
import { readChordItem } from './read-chords';
import type { WarningSink } from './warnings';
import type { XmlElement } from './xml';

const META_FIELDS = {
  Title: 'title',
  SubTitle: 'subtitle',
  Artist: 'artist',
  Album: 'album',
  Words: 'words',
  Music: 'music',
  WordsAndMusic: 'wordsAndMusic',
  Copyright: 'copyright',
  Tabber: 'tab',
  Instructions: 'instructions',
} as const satisfies Record<string, Exclude<keyof GpifMeta, 'notices'>>;

function isMetaField(name: string): name is keyof typeof META_FIELDS {
  return Object.hasOwn(META_FIELDS, name);
}

/** Score-level page and view settings Guitar Pro keeps for its own layout. */
const SCORE_LAYOUT = new Set([
  'FirstPageHeader',
  'FirstPageFooter',
  'PageHeader',
  'PageFooter',
  'ScoreSystemsDefaultLayout',
  'ScoreSystemsLayout',
  'ScoreZoomPolicy',
  'ScoreZoom',
  'MultiVoice',
  'PageSetup',
]);

export function emptyMeta(): GpifMeta {
  return {
    title: '',
    subtitle: '',
    artist: '',
    album: '',
    words: '',
    music: '',
    wordsAndMusic: '',
    copyright: '',
    tab: '',
    instructions: '',
    notices: [],
  };
}

export function readScoreMeta(sink: WarningSink, element: XmlElement, path: string): GpifMeta {
  const meta = emptyMeta();
  for (const node of element.children) {
    const at = childPath(path, node);
    if (isMetaField(node.name)) {
      meta[META_FIELDS[node.name]] = node.text;
    } else if (node.name === 'Notices') {
      meta.notices = node.text === '' ? [] : node.text.split(/\r?\n/);
    } else if (SCORE_LAYOUT.has(node.name)) {
      sink.warn(
        'not-modelled',
        at,
        'Page layout and headers: not modelled, dropped',
        'score-layout',
      );
    } else {
      unknownElement(sink, at);
    }
  }
  return meta;
}

/**
 * Units 1 to 5 are eighth, quarter, dotted quarter, half and dotted half; the factor turns
 * "unit = value" into quarter-note BPM. A value without a unit is per quarter note.
 */
const TEMPO_UNITS: readonly (readonly [TempoUnit, number])[] = [
  ['eighth', 0.5],
  ['quarter', 1],
  ['dottedQuarter', 1.5],
  ['half', 2],
  ['dottedHalf', 3],
];

interface RawAutomation {
  type: string;
  linear: boolean;
  bar: number;
  position: number;
  value: string;
  text?: string;
  visible: boolean;
}

function readAutomation(sink: WarningSink, element: XmlElement, path: string): RawAutomation {
  const automation: RawAutomation = {
    type: '',
    linear: false,
    bar: 0,
    position: 0,
    value: '',
    visible: true,
  };
  for (const node of element.children) {
    switch (node.name) {
      case 'Type':
        automation.type = node.text.trim();
        break;
      case 'Linear':
        automation.linear = parseBool(node.text);
        break;
      case 'Bar':
        automation.bar = parseIntOr(node.text, 0);
        break;
      case 'Position':
        automation.position = parseFloatOr(node.text, 0);
        break;
      case 'Value':
        automation.value = node.text;
        break;
      case 'Text':
        if (node.text !== '') automation.text = node.text;
        break;
      case 'Visible':
        automation.visible = parseBool(node.text);
        break;
      default:
        unknownElement(sink, childPath(path, node));
    }
  }
  return automation;
}

function toTempo(sink: WarningSink, raw: RawAutomation, path: string): GpifTempo | undefined {
  const [valueText, unitText] = splitList(raw.value);
  const value = parseFloatOr(valueText, Number.NaN);
  if (!(value > 0)) {
    sink.warn('invalid-value', path, `Tempo "${raw.value}" is not a positive number; dropped`);
    return undefined;
  }
  const unitIndex = unitText === undefined ? 2 : parseIntOr(unitText, 2);
  let entry = TEMPO_UNITS[unitIndex - 1];
  if (!entry) {
    sink.warn(
      'invalid-value',
      path,
      `Tempo unit "${String(unitText)}" is outside 1 to 5; read as quarter`,
    );
    entry = ['quarter', 1];
  }
  if (!raw.visible) notModelled(sink, path, 'A hidden tempo mark');
  const tempo: GpifTempo = {
    path,
    bar: raw.bar,
    position: Math.min(1, Math.max(0, raw.position)),
    linear: raw.linear,
    bpm: value * entry[1],
  };
  if (entry[0] !== 'quarter') tempo.unit = entry[0];
  if (raw.text !== undefined) tempo.label = raw.text;
  return tempo;
}

export interface MasterTrack {
  trackOrder: string[];
  tempos: GpifTempo[];
  anacrusis: boolean;
}

export function readMasterTrack(sink: WarningSink, element: XmlElement, path: string): MasterTrack {
  const result: MasterTrack = { trackOrder: [], tempos: [], anacrusis: false };
  for (const node of element.children) {
    const at = childPath(path, node);
    switch (node.name) {
      case 'Tracks':
        result.trackOrder = splitList(node.text);
        break;
      case 'Anacrusis':
        result.anacrusis = true;
        break;
      case 'Automations':
        for (const automation of node.children) {
          const automationPath = childPath(at, automation);
          if (automation.name !== 'Automation') {
            unknownElement(sink, automationPath);
            continue;
          }
          const raw = readAutomation(sink, automation, automationPath);
          if (raw.type === 'Tempo') {
            const tempo = toTempo(sink, raw, automationPath);
            if (tempo) result.tempos.push(tempo);
          } else {
            notModelled(sink, `${automationPath}[${raw.type}]`, `A ${raw.type} automation`);
          }
        }
        break;
      case 'RSE':
        if (!isBlank(node)) notModelled(sink, at, 'The RSE master effects');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  return result;
}

function readTuning(sink: WarningSink, property: XmlElement, path: string): number[] {
  for (const node of property.children) {
    const at = childPath(path, node);
    switch (node.name) {
      case 'Pitches':
      case 'Instrument':
      case 'LabelVisible':
        break;
      case 'Label':
        if (node.text !== '') notModelled(sink, at, 'A tuning label');
        break;
      case 'Flat':
        if (node.text.trim() !== '') notModelled(sink, at, 'Tuning flat display');
        break;
      default:
        unknownElement(sink, at);
    }
  }
  return splitList(childText(property, 'Pitches')).map((pitch) => parseIntOr(pitch, 0));
}

function readChordCollection(
  sink: WarningSink,
  property: XmlElement,
  path: string,
  into: Map<string, Chord>,
  overwrite: boolean,
): void {
  const items = child(property, 'Items');
  for (const item of items?.children ?? []) {
    const at = childPath(childPath(path, items ?? property), item);
    const id = item.attributes.get('id');
    if (item.name !== 'Item' || id === undefined) {
      unknownElement(sink, at);
      continue;
    }
    if (overwrite || !into.has(id)) into.set(id, readChordItem(sink, item, at));
  }
}

/**
 * Staff properties, and GP6's track-level `Properties`, which carry the same names. Defaults that
 * say nothing (no partial capo, empty working sets) are read silently.
 */
function readStaffProperties(
  sink: WarningSink,
  element: XmlElement,
  path: string,
  staff: GpifStaff,
): void {
  for (const property of element.children) {
    const at = childPath(path, property);
    if (property.name === 'Name') {
      if (property.text !== '') notModelled(sink, at, 'A tuning name');
      continue;
    }
    if (property.name !== 'Property') {
      unknownElement(sink, at);
      continue;
    }
    switch (property.attributes.get('name')) {
      case 'Tuning':
        staff.tuning = readTuning(sink, property, at);
        break;
      case 'CapoFret':
        staff.capo = Math.max(0, parseIntOr(childText(property, 'Fret'), 0));
        break;
      case 'FretCount':
        staff.fretCount = Math.max(0, parseIntOr(childText(property, 'Number'), 24));
        break;
      case 'PartialCapoFret':
        if (parseIntOr(childText(property, 'Fret'), 0) !== 0)
          notModelled(sink, at, 'A partial capo');
        break;
      case 'PartialCapoStringFlags':
        if (/[^0\s]/.test(childText(property, 'Bitset') ?? ''))
          notModelled(sink, at, 'A partial capo');
        break;
      case 'DiagramCollection':
        readChordCollection(sink, property, at, staff.chords, true);
        break;
      case 'ChordCollection':
        readChordCollection(sink, property, at, staff.chords, false);
        break;
      case 'DiagramWorkingSet':
      case 'ChordWorkingSet':
        // The editor's palette of recently used chords, not part of the score.
        break;
      case 'TuningFlat':
        notModelled(sink, at, 'Tuning flat display');
        break;
      default:
        unknownElement(sink, at);
    }
  }
}

function readSounds(sink: WarningSink, element: XmlElement, path: string, track: GpifTrack): void {
  for (const sound of element.children) {
    const at = childPath(path, sound);
    if (sound.name !== 'Sound') {
      unknownElement(sink, at);
      continue;
    }
    const midi = child(sound, 'MIDI');
    const program = Math.min(127, Math.max(0, parseIntOr(midi && childText(midi, 'Program'), 0)));
    const msb = parseIntOr(midi && childText(midi, 'MSB'), 0) & 127;
    const lsb = parseIntOr(midi && childText(midi, 'LSB'), 0) & 127;
    const bank = (msb << 7) | lsb;
    const key = [childText(sound, 'Path'), childText(sound, 'Name'), childText(sound, 'Role')]
      .map((part) => part ?? '')
      .join(';');
    if (track.sounds.size === 0) {
      track.program = program;
      track.bank = bank;
    }
    track.sounds.set(key, { program, bank });
    for (const node of sound.children) {
      if (node.name === 'RSE') notModelled(sink, childPath(at, node), 'An RSE sound patch');
      else if (!['Name', 'Label', 'Path', 'Role', 'MIDI'].includes(node.name)) {
        unknownElement(sink, childPath(at, node));
      }
    }
  }
}

function readInstrumentSet(
  sink: WarningSink,
  element: XmlElement,
  path: string,
  track: GpifTrack,
): void {
  for (const node of element.children) {
    const at = childPath(path, node);
    switch (node.name) {
      case 'Type':
        if (node.text.trim() === 'drumKit') track.drums = true;
        break;
      case 'Name':
        break;
      case 'LineCount':
        if (parseIntOr(node.text, 5) !== 5)
          notModelled(sink, at, 'A staff with other than five lines');
        break;
      case 'Elements':
        for (const element of node.children) {
          const elementName = childText(element, 'Name') ?? '';
          const articulations = child(element, 'Articulations')?.children ?? [];
          for (const articulation of articulations) {
            track.articulations.push({
              name: `${elementName} ${childText(articulation, 'Name') ?? ''}`.trim(),
              output: parseIntOr(childText(articulation, 'OutputMidiNumber'), 0),
            });
          }
        }
        break;
      default:
        unknownElement(sink, at);
    }
  }
}

/** RSE channel-strip parameters 11 and 12 are pan and volume, 0 to 1. */
function readChannelStrip(element: XmlElement, track: GpifTrack): void {
  const strip = child(element, 'ChannelStrip');
  const parameters = splitList(strip && childText(strip, 'Parameters'));
  if (parameters.length < 13) return;
  const scale = (text: string | undefined): number =>
    Math.min(127, Math.max(0, Math.round(parseFloatOr(text, 0) * 127)));
  track.pan = scale(parameters[11]);
  track.volume = scale(parameters[12]);
}

function readLyrics(element: XmlElement): LyricLine[] {
  const lines = element.children
    .filter((line) => line.name === 'Line')
    .map((line) => ({
      text: childText(line, 'Text') ?? '',
      // gpif's offset is already a 0-based master-bar index; GP3 to GP5 store it 1-based.
      startBar: Math.max(0, parseIntOr(childText(line, 'Offset'), 0)),
    }));
  return lines.some((line) => line.text !== '') ? lines : [];
}

function newStaff(): GpifStaff {
  return { capo: 0, chords: new Map() };
}

/** Elements Guitar Pro keeps for its own playback routing and views, grouped per warning. */
const TRACK_NOT_MODELLED: Readonly<Record<string, string>> = {
  SystemsDefautLayout: 'Track system layout',
  SystemsLayout: 'Track system layout',
  IconId: 'A track icon',
  AutoBrush: 'Automatic brush',
  UseOneChannelPerString: 'MIDI channel routing',
  MidiConnection: 'MIDI ports and channels',
  AudioEngineState: 'The audio engine choice',
  NotationPatch: 'A drum notation patch',
  PartSounding: 'A sounding-part transposition',
  LetRingThroughout: 'Let ring throughout',
  AutoAccentuation: 'Automatic accentuation',
};

export function readTrack(sink: WarningSink, element: XmlElement, path: string): GpifTrack {
  const track: GpifTrack = {
    id: element.attributes.get('id') ?? '',
    path,
    name: '',
    shortName: '',
    drums: false,
    articulations: [],
    staves: [],
    program: 0,
    bank: 0,
    sounds: new Map(),
    mute: false,
    solo: false,
    lyrics: [],
    automations: [],
  };
  const trackProperties = newStaff();
  let hasTrackProperties = false;
  let grandStaff = false;

  for (const node of element.children) {
    const at = childPath(path, node);
    const text = node.text.trim();
    switch (node.name) {
      case 'Name':
        track.name = node.text;
        break;
      case 'ShortName':
        track.shortName = node.text;
        break;
      case 'Color': {
        const rgb = splitList(node.text).map((part) =>
          Math.min(255, Math.max(0, parseIntOr(part, 0))),
        );
        if (rgb.length >= 3) {
          track.color = `#${rgb
            .slice(0, 3)
            .map((channel) => channel.toString(16).padStart(2, '0'))
            .join('')}`;
        }
        break;
      }
      case 'InstrumentSet':
        readInstrumentSet(sink, node, at, track);
        break;
      case 'Instrument': {
        // GP6 names a two-staff instrument with a `-gs` or `GrandStaff` suffix.
        const ref = node.attributes.get('ref') ?? '';
        if (ref.endsWith('-gs') || ref.endsWith('GrandStaff')) grandStaff = true;
        break;
      }
      case 'Transpose': {
        const octave = parseIntOr(childText(node, 'Octave'), 0);
        // Guitar Pro stores sounding minus written; the model keeps written minus sounding.
        // Negating 0 gives -0, which JSON writes as 0, so a native round trip would differ.
        track.octaveShift = octave === 0 ? 0 : -octave;
        if (parseIntOr(childText(node, 'Chromatic'), 0) !== 0) {
          notModelled(sink, at, 'A chromatic transposition');
        }
        break;
      }
      case 'RSE':
        readChannelStrip(node, track);
        notModelled(sink, at, 'RSE channel settings beyond volume and pan');
        break;
      case 'ForcedSound':
        if (parseIntOr(text, -1) !== -1) notModelled(sink, at, 'A forced sound');
        break;
      case 'Sounds':
        readSounds(sink, node, at, track);
        break;
      case 'GeneralMidi':
      case 'MIDISettings':
        // GP6's form of the program and the percussion flag.
        track.program = Math.min(127, Math.max(0, parseIntOr(childText(node, 'Program'), 0)));
        if (node.attributes.get('table') === 'Percussion') track.drums = true;
        break;
      case 'PlaybackState':
        track.solo = text === 'Solo';
        track.mute = text === 'Mute';
        break;
      case 'PalmMute':
        if (parseFloatOr(text, 0) !== 0) notModelled(sink, at, 'Track palm-mute intensity');
        break;
      case 'PlayingStyle':
        if (text !== 'Default') notModelled(sink, at, 'A playing style');
        break;
      case 'Lyrics':
        track.lyrics = readLyrics(node);
        break;
      case 'Staves':
        for (const staffElement of node.children) {
          const staffPath = childPath(at, staffElement);
          if (staffElement.name !== 'Staff') {
            unknownElement(sink, staffPath);
            continue;
          }
          const staff = newStaff();
          for (const part of staffElement.children) {
            if (part.name === 'Properties')
              readStaffProperties(sink, part, childPath(staffPath, part), staff);
            else unknownElement(sink, childPath(staffPath, part));
          }
          track.staves.push(staff);
        }
        break;
      case 'Properties':
        hasTrackProperties = true;
        readStaffProperties(sink, node, at, trackProperties);
        break;
      case 'Automations':
        for (const automation of node.children) {
          const automationPath = childPath(at, automation);
          if (automation.name !== 'Automation') {
            unknownElement(sink, automationPath);
            continue;
          }
          const raw = readAutomation(sink, automation, automationPath);
          const entry: GpifTrackAutomation = {
            path: automationPath,
            type: raw.type,
            bar: raw.bar,
            position: Math.min(1, Math.max(0, raw.position)),
            value: raw.value,
          };
          track.automations.push(entry);
        }
        break;
      default: {
        const what = TRACK_NOT_MODELLED[node.name];
        if (what === undefined) unknownElement(sink, at);
        else notModelled(sink, at, what);
      }
    }
  }

  // GP6 keeps tuning and chords on the track; GP7 on each staff.
  if (track.staves.length === 0)
    track.staves.push(hasTrackProperties ? trackProperties : newStaff());
  else if (hasTrackProperties) {
    const first = track.staves[0];
    if (first && first.tuning === undefined && trackProperties.tuning !== undefined) {
      first.tuning = trackProperties.tuning;
    }
  }
  if (grandStaff && track.staves.length === 1) track.staves.push(newStaff());
  return track;
}
