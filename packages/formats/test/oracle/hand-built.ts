import { readGpx } from '../../src/index';
import {
  bar,
  beat,
  gpif,
  guitarTrack,
  masterBar,
  note,
  oneBar,
  property,
  rhythm,
  voice,
} from '../../src/gpif/test/gpif-builder';
import { gpx } from '../gpx-builder';
import { compareProjections, type Difference } from './compare';
import { loadWithAlphaTab, projectAlphaTab } from './project-alphatab';
import { projectOurs } from './project-ours';
import type { FixtureFormat } from './readers';
import type { Projections } from './tolerances';

export interface HandBuilt {
  name: string;
  format: FixtureFormat;
  projections: Projections;
  differences: Difference[];
  /** The warning codes our reader raised. */
  warnings: string[];
}

/** The default channel strip is 12 for us and 15 for alphaTab, which is no case's subject. */
const DEFAULT_VOLUME = /^tracks\[\d+\]\.volume$/;

/** A gpif document read by both readers, through the gpx container both of them open. */
export function compareGpif(name: string, xml: string): HandBuilt {
  const bytes = gpx({ 'score.gpif': xml });
  const { score, warnings } = readGpx(bytes);
  const projections = {
    ours: projectOurs(score),
    alphaTab: projectAlphaTab(
      loadWithAlphaTab(bytes),
      score.tracks.map((track) => track.kind),
    ),
  };
  return {
    name,
    format: 'gpx',
    projections,
    differences: compareProjections(name, projections.ours, projections.alphaTab).filter(
      (difference) => !DEFAULT_VOLUME.test(difference.path),
    ),
    warnings: warnings.map((warning) => warning.code),
  };
}

const QUARTER = [rhythm('0', 'Quarter')];
const HALF = [rhythm('0', 'Half')];
const WHOLE = [rhythm('0', 'Whole')];

/** A whammy curve in gpif's properties: values origin, middle, destination; four offsets. */
function whammy(
  values: [number, number, number],
  offsets: [number, number, number, number],
): string {
  const float = (name: string, value: number): string =>
    property(`WhammyBar${name}`, `<Float>${String(value)}</Float>`);
  return `<Properties>${property('WhammyBar', '<Enable />')}${float('OriginValue', values[0])}${float('MiddleValue', values[1])}${float('DestinationValue', values[2])}${float('OriginOffset', offsets[0])}${float('MiddleOffset1', offsets[1])}${float('MiddleOffset2', offsets[2])}${float('DestinationOffset', offsets[3])}</Properties>`;
}

const whammyBar = (
  name: string,
  values: [number, number, number],
  offsets: [number, number, number, number],
): HandBuilt =>
  compareGpif(
    name,
    oneBar([beat('0', '0', '0', whammy(values, offsets))], [note('0', 2, 5)], QUARTER),
  );

/** Track 1 carries the chromatic part; track 0 stays put, since alphaTab also transposes the key by track 0's. */
const transposed = (chromatic: number, octave = -1): HandBuilt =>
  compareGpif(
    `chromatic ${String(chromatic)}`,
    gpif({
      tracks: [
        guitarTrack('0'),
        guitarTrack('1')
          .replace('<Chromatic>0</Chromatic>', `<Chromatic>${String(chromatic)}</Chromatic>`)
          .replace('<Octave>-1</Octave>', `<Octave>${String(octave)}</Octave>`),
      ],
      masterBars: [masterBar('0 1')],
      bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
      voices: [voice('0', '0'), voice('1', '0')],
      beats: [beat('0', '0', '0')],
      notes: [note('0', 2, 5)],
      rhythms: WHOLE,
    }),
  );

const ORGAN =
  '<Sound><Name>Organ</Name><Path>Keys/Organ</Path><Role>Factory</Role><MIDI><Program>19</Program></MIDI></Sound></Sounds>';

const soundChange = (bar: number, position: number): string =>
  `<Automations><Automation><Type>Sound</Type><Linear>false</Linear><Bar>${String(bar)}</Bar><Position>${String(position)}</Position><Visible>true</Visible><Value><![CDATA[Keys/Organ;Organ;Factory]]></Value></Automation></Automations>`;

const organTrack = (automation: string): string =>
  guitarTrack('0', { extra: automation }).replace('</Sounds>', ORGAN);

/** A track with a sound change at `position` of bar `at`, over two bars of `voices`. */
function withSoundChange(
  name: string,
  at: number,
  position: number,
  barVoices: [string, string],
): HandBuilt {
  return compareGpif(
    name,
    gpif({
      tracks: [organTrack(soundChange(at, position))],
      masterBars: [masterBar('0'), masterBar('1')],
      bars: [bar('0', barVoices[0]), bar('1', barVoices[1])],
      voices: [voice('0', '0')],
      beats: [beat('0', '0', '0')],
      notes: [note('0', 2, 5)],
      rhythms: WHOLE,
    }),
  );
}

export const HAND_BUILT = {
  /** Origin, two equal middle values and a destination, falling: alphaTab keeps two points. */
  whammyMonotonic: (): HandBuilt => whammyBar('whammy monotonic', [0, -25, -50], [0, 35, 35, 43]),
  /** The middle points of a dip share an offset: alphaTab keeps three. */
  whammyDip: (): HandBuilt => whammyBar('whammy dip', [0, -50, 0], [0, 30, 30, 100]),
  /** A dip whose middle points are apart: alphaTab keeps all four. */
  whammyDipApart: (): HandBuilt => whammyBar('whammy dip apart', [0, -50, 0], [0, 30, 60, 100]),
  chromatic: (): HandBuilt => transposed(-7),
  chromaticOctave: (): HandBuilt => transposed(-12),
  octaveOnly: (): HandBuilt => transposed(0, -2),
  /** A sound change half way through a half-note bar: ours on the second beat, alphaTab's on the first. */
  soundChangeMidBar: (): HandBuilt =>
    compareGpif(
      'sound change mid bar',
      gpif({
        tracks: [organTrack(soundChange(0, 0.5))],
        masterBars: [masterBar('0')],
        bars: [bar('0', '0 -1 -1 -1')],
        voices: [voice('0', '0 1')],
        beats: [beat('0', '0', '0'), beat('1', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: HALF,
      }),
    ),
  /** The same change at the bar's start: both sides agree. */
  soundChangeAtStart: (): HandBuilt =>
    compareGpif(
      'sound change at the start of a bar',
      gpif({
        tracks: [organTrack(soundChange(1, 0))],
        masterBars: [masterBar('0'), masterBar('1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
        voices: [voice('0', '0'), voice('1', '0')],
        beats: [beat('0', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: WHOLE,
      }),
    ),
  /** Voice 0 is `-1` and voice 1 holds the notes: ours puts the change on voice 1, alphaTab's on voice 0's placeholder. */
  soundChangeOnSecondVoice: (): HandBuilt =>
    withSoundChange('sound change with an empty first voice', 0, 0, ['-1 0 -1 -1', '-1 -1 -1 -1']),
  /** A bar of `-1` voices with a sound change in it: alphaTab's placeholder holds it, we drop it. */
  soundChangeInEmptyBar: (): HandBuilt =>
    withSoundChange('sound change in an empty bar', 1, 0, ['0 -1 -1 -1', '-1 -1 -1 -1']),
  /** The same empty bar with no automation: the projection already drops alphaTab's placeholders. */
  emptyBar: (): HandBuilt =>
    compareGpif(
      'empty bar',
      gpif({
        masterBars: [masterBar('0'), masterBar('1')],
        bars: [bar('0', '0 -1 -1 -1'), bar('1', '-1 -1 -1 -1')],
        voices: [voice('0', '0')],
        beats: [beat('0', '0', '0')],
        notes: [note('0', 2, 5)],
        rhythms: WHOLE,
      }),
    ),
} as const;
