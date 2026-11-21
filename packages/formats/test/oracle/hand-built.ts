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

const strokeLength = (ticks: number): HandBuilt =>
  compareGpif(
    `stroke length ${String(ticks)}`,
    oneBar(
      [
        beat(
          '0',
          '0',
          '0',
          `<Properties>${property('Brush', '<Direction>Down</Direction>')}</Properties><XProperties><XProperty id="687935489"><Int>${String(ticks)}</Int></XProperty></XProperties>`,
        ),
      ],
      [note('0', 2, 5)],
      QUARTER,
    ),
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

/**
 * A track with a sound change at `position` of bar `at`. Each bar of `barVoices` is a gpif voice
 * list in which `0` stands for a whole note of its own: a voice and beat per bar, since alphaTab
 * shares a voice object between the bars that reference one id.
 */
function withSoundChange(
  name: string,
  at: number,
  position: number,
  barVoices: string[],
): HandBuilt {
  const filled = barVoices.flatMap((voices, index) =>
    voices.split(' ').includes('0') ? [String(index)] : [],
  );
  return compareGpif(
    name,
    gpif({
      tracks: [organTrack(soundChange(at, position))],
      masterBars: barVoices.map((_, index) => masterBar(String(index))),
      bars: barVoices.map((voices, index) =>
        bar(
          String(index),
          voices
            .split(' ')
            .map((id) => (id === '0' ? String(index) : id))
            .join(' '),
        ),
      ),
      voices: filled.map((id) => voice(id, id)),
      beats: filled.map((id) => beat(id, '0', '0')),
      notes: [note('0', 2, 5)],
      rhythms: WHOLE,
    }),
  );
}

const midiProperty = (value: number): string =>
  property('Midi', `<Number>${String(value)}</Number>`);

const slideFlags = (flags: number): string => property('Slide', `<Flags>${String(flags)}</Flags>`);

const TIE_DESTINATION = '<Tie origin="false" destination="true" />';

/** The same tie across a barline: the two notes share a string in the last beat of bar 0. */
const tieAcrossBar = (): HandBuilt =>
  compareGpif(
    'tie across a barline after two notes on one string',
    gpif({
      masterBars: [masterBar('0'), masterBar('1')],
      bars: [bar('0', '0 -1 -1 -1'), bar('1', '1 -1 -1 -1')],
      voices: [voice('0', '0'), voice('1', '1')],
      beats: [beat('0', '0', '0 1'), beat('1', '0', '2')],
      notes: [
        note('0', 2, 5, '', midiProperty(55)),
        note('1', 2, 7, '', midiProperty(57)),
        note('2', 2, 5, TIE_DESTINATION, midiProperty(55)),
      ],
      rhythms: WHOLE,
    }),
  );

export const HAND_BUILT = {
  tieAcrossBarOnSharedString: tieAcrossBar,
  /** Two notes on one string, then a tie to the lower: alphaTab's tie takes the upper's pitch. */
  tieOnSharedString: (): HandBuilt =>
    compareGpif(
      'tie after two notes on one string',
      oneBar(
        [beat('0', '0', '0 1'), beat('1', '0', '2')],
        [
          note('0', 2, 5, '', midiProperty(55)),
          note('1', 2, 7, '', midiProperty(57)),
          note('2', 2, 5, TIE_DESTINATION, midiProperty(55)),
        ],
        QUARTER,
      ),
    ),
  /** A closed wah mark on a rest, which the oracle compares beat by beat. */
  wahOnRest: (): HandBuilt =>
    compareGpif(
      'wah closed on a rest',
      oneBar(
        [beat('0', '0', '0', '<Wah>Closed</Wah>'), beat('1', '0', '', '<Wah>Open</Wah>')],
        [note('0', 2, 5)],
        QUARTER,
      ),
    ),
  /** A pick slide down beside a slide out (flags 64 + 4): we keep both, alphaTab keeps one. */
  pickScrapeWithSlideOut: (): HandBuilt =>
    compareGpif(
      'pick scrape beside a slide out',
      oneBar([beat('0', '0', '0')], [note('0', 2, 5, '', slideFlags(64 + 4))], QUARTER),
    ),
  /** A pick slide on its own: both sides agree. */
  pickScrapeAlone: (): HandBuilt =>
    compareGpif(
      'pick scrape alone',
      oneBar([beat('0', '0', '0')], [note('0', 2, 5, '', slideFlags(128))], QUARTER),
    ),
  /** Origin, two equal middle values and a destination, falling: alphaTab keeps two points. */
  whammyMonotonic: (): HandBuilt => whammyBar('whammy monotonic', [0, -25, -50], [0, 35, 35, 43]),
  /** The middle points of a dip share an offset: alphaTab keeps three. */
  whammyDip: (): HandBuilt => whammyBar('whammy dip', [0, -50, 0], [0, 30, 30, 100]),
  /** A dip whose middle points are apart: alphaTab keeps all four. */
  whammyDipApart: (): HandBuilt => whammyBar('whammy dip apart', [0, -50, 0], [0, 30, 60, 100]),
  /** A brush of 74 ticks: ours is a 64th, alphaTab keeps the exact length. */
  strokeLength74: (): HandBuilt => strokeLength(74),
  /** A brush of 480 ticks, an exact eighth: both sides agree. */
  strokeLength480: (): HandBuilt => strokeLength(480),
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
  /** A bar of `-1` voices with a sound change in it: alphaTab's placeholder holds it, we move it to the next bar's beat. */
  soundChangeInEmptyBar: (): HandBuilt =>
    withSoundChange('sound change in an empty bar', 1, 0, [
      '0 -1 -1 -1',
      '-1 -1 -1 -1',
      '0 -1 -1 -1',
    ]),
  /** The same change in the last bar: no later beat exists, so we drop it. */
  soundChangeInLastEmptyBar: (): HandBuilt =>
    withSoundChange('sound change in a trailing empty bar', 1, 0, ['0 -1 -1 -1', '-1 -1 -1 -1']),
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
