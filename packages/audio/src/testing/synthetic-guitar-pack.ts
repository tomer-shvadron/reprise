import type { SfzFiles } from '../sfz/pack';
import { encodeWav, sine } from '../sfz/test/encode';
import type { SyntheticSfzPack } from './synthetic-pack';

/** The MIDI key every tone is rooted at: a test plays it to hear the sample unshifted. */
export const GUITAR_ROOT_KEY = 69;

/** Hz of each layer's sine, far enough apart that a spectral test tells them apart. */
export const GUITAR_TONES = {
  default: 440,
  palmMute: 550,
  harmonic: 660,
  legato: 770,
  release: 1100,
} as const;

/** The tones of the layers `articulations: true` adds. */
export const GUITAR_EXTRA_TONES = { dead: 880, staccato: 990 } as const;

/** The tones of the per-file sets `perFile: true` adds: `gtr_pm.sfz` and `gtr_stacc.sfz`. */
export const GUITAR_FILE_TONES = { palmMute: 2000, staccato: 2100 } as const;

/** `rt_decay` of the release samples, in dB per second held. */
export const GUITAR_RELEASE_DECAY = 6;

/**
 * The muted-string noise keys `noises` adds, above every layer's range (40 to 88) and the
 * switches (24 to 33): one sine per key (at least 100 Hz apart), the first key with two takes by
 * `seq_length=2`, and a release region on each that a noise strike must never start.
 */
export const GUITAR_NOISES = {
  keys: [100, 101, 102, 103],
  /** The tones of each key's takes, in `seq_position` order. */
  tones: [[3000, 3100], [3200], [3300], [3400]],
} as const;

export interface SyntheticGuitarPack extends SyntheticSfzPack {
  /** What `PackAssignment.entries` takes for it: only the default file, with its labelled layers. */
  entries: Readonly<Record<string, string>>;
  /** The keyswitch layer id the loader makes for each labelled set: `sw:<k>`. */
  layers: Readonly<{
    palmMute: string;
    harmonic: string;
    legato: string;
    /** Only with `articulations: true`. */
    dead?: string;
    staccato?: string;
  }>;
}

/**
 * The keys and tones of the regions `selection: true` adds, below the layers' own range
 * (40 to 88) so that nothing a pack without them plays changes. Each key's attack regions are
 * of the default layer, and each has the one-shot release sample of the layers too.
 */
export const GUITAR_SELECTION = {
  /** Two velocity layers: `lovel`/`hivel` 1 to 63 and 64 to 127. */
  velocity: { key: 30, tones: [300, 350] },
  /** Three takes by `seq_length=3` and `seq_position`. */
  sequence: { key: 31, tones: [1200, 1300, 1400] },
  /** Three takes by `lorand`/`hirand`, thirds of [0, 1). */
  random: { key: 32, tones: [1500, 1600, 1700] },
  /** A `trigger=first` attack and a `trigger=legato` region, the second for a hammer-on or a pull-off. */
  legato: { key: 33, tones: [1800, 1900] },
} as const;

export interface SyntheticGuitarPackOptions {
  /** Sample rate of the generated WAV files; 22,050 Hz by default. */
  sampleRate?: number;
  /**
   * Adds the velocity layers, round robins and legato trigger of `GUITAR_SELECTION` on keys
   * below the keyswitch layers' range, each with a release sample. Off by default, so the pack
   * keeps the shape the articulation sets are tested on.
   */
  selection?: boolean;
  /**
   * Adds a `Dead Note` and a `Staccato` keyswitch layer (28 and 29) to the default file, tones
   * `GUITAR_EXTRA_TONES`, so every set the planner maps has a layer to play.
   */
  articulations?: boolean;
  /**
   * Adds `gtr_pm.sfz` and `gtr_stacc.sfz`, one plain file per set (tones `GUITAR_FILE_TONES`),
   * and returns them in `entries` beside the default, the way a pack that ships a file per
   * articulation is declared.
   */
  perFile?: boolean;
  /**
   * Adds the muted-string noise keys of `GUITAR_NOISES` and returns `entries.dead` for them
   * (`<file>#key:100-103`): `true` puts them in `default.sfz`, `'file'` in `noises.sfz`, a file of
   * their own, as a pack whose default sound has none borrows another file's.
   */
  noises?: boolean | 'file';
}

const SWITCHES = {
  default: 24,
  palmMute: 25,
  harmonic: 26,
  legato: 27,
  dead: 28,
  staccato: 29,
} as const;
const LABELS = {
  default: 'Sustain',
  palmMute: 'Palm Mute',
  harmonic: 'Natural Harmonic',
  legato: 'Hammer-on',
  dead: 'Dead Note',
  staccato: 'Staccato',
} as const;

const selectionTones = (): number[] =>
  Object.values(GUITAR_SELECTION).flatMap((group) => [...group.tones]);
const selectionPath = (hertz: number): string => `samples/take${String(hertz)}.wav`;

/**
 * The extra regions: one `<group>` per kind, on its own key and rooted there, the way real packs
 * lay out their round robins, so that nothing inherits the keyswitch group's `sw_*` opcodes.
 */
function selectionRegions(): string[] {
  const { velocity, sequence, random, legato } = GUITAR_SELECTION;
  const group = (key: number): string =>
    `<group> lokey=${String(key)} hikey=${String(key)} pitch_keycenter=${String(key)}`;
  const region = (hertz: number, opcodes = ''): string =>
    `<region> sample=${selectionPath(hertz)} ${opcodes}`.trimEnd();
  const release = `<region> sample=samples/release.wav trigger=release rt_decay=${String(GUITAR_RELEASE_DECAY)} loop_mode=one_shot`;
  const [soft, loud] = velocity.tones;
  const [legatoAttack, legatoTrigger] = legato.tones;
  return [
    group(velocity.key),
    region(soft, 'lovel=1 hivel=63'),
    region(loud, 'lovel=64 hivel=127'),
    release,
    group(sequence.key),
    ...sequence.tones.map((hertz, index) =>
      region(hertz, `seq_length=3 seq_position=${String(index + 1)}`),
    ),
    release,
    group(random.key),
    ...random.tones.map((hertz, index) =>
      region(hertz, `lorand=${String(index / 3)} hirand=${String((index + 1) / 3)}`),
    ),
    release,
    group(legato.key),
    region(legatoAttack, 'trigger=first'),
    region(legatoTrigger, 'trigger=legato'),
    release,
  ];
}

const noisePath = (hertz: number): string => `samples/noise${String(hertz)}.wav`;

function noiseRegions(): string[] {
  const lines: string[] = [];
  for (const [index, key] of GUITAR_NOISES.keys.entries()) {
    const takes = GUITAR_NOISES.tones[index] ?? [];
    lines.push(
      `<group> lokey=${String(key)} hikey=${String(key)} pitch_keycenter=${String(key)}`,
      ...takes.map(
        (hertz, take) =>
          `<region> sample=${noisePath(hertz)}${takes.length > 1 ? ` seq_length=${String(takes.length)} seq_position=${String(take + 1)}` : ''}`,
      ),
      `<region> sample=samples/release.wav trigger=release rt_decay=${String(GUITAR_RELEASE_DECAY)} loop_mode=one_shot`,
    );
  }
  return lines;
}

/**
 * A reference electric guitar built in memory, shaped like a keyswitch library: `default.sfz`
 * holds a sustain layer and a palm-mute, a harmonic and a legato one, each switched by a labelled
 * `sw_last` key and each a sine of its own pitch (`GUITAR_TONES`), plus one-shot release samples
 * that belong to every layer and carry `rt_decay`. No curated pack has a muted layer, so this is
 * what tests of the articulation sets play.
 */
export function syntheticGuitarPack(options: SyntheticGuitarPackOptions = {}): SyntheticGuitarPack {
  const rate = options.sampleRate ?? 22_050;
  const layerText = (set: keyof typeof SWITCHES): string =>
    `<region> sample=samples/${set}.wav sw_last=${String(SWITCHES[set])} sw_label=${LABELS[set]}`;
  const sfz = [
    '<global> lokey=40 hikey=88 pitch_keycenter=69',
    `<group> sw_lokey=24 sw_hikey=${options.articulations ? '29' : '27'} sw_default=${String(SWITCHES.default)}`,
    layerText('default'),
    layerText('palmMute'),
    layerText('harmonic'),
    layerText('legato'),
    ...(options.articulations ? [layerText('dead'), layerText('staccato')] : []),
    `<region> sample=samples/release.wav trigger=release rt_decay=${String(GUITAR_RELEASE_DECAY)} loop_mode=one_shot`,
    ...(options.selection ? selectionRegions() : []),
    ...(options.noises === true ? noiseRegions() : []),
    '',
  ].join('\n');
  const tone = (frequency: number, seconds: number): Uint8Array =>
    encodeWav([sine(frequency, rate, seconds)], rate);
  const contents = new Map<string, Uint8Array>([
    ['default.sfz', new TextEncoder().encode(sfz)],
    ['samples/default.wav', tone(GUITAR_TONES.default, 0.5)],
    ['samples/palmMute.wav', tone(GUITAR_TONES.palmMute, 0.5)],
    ['samples/harmonic.wav', tone(GUITAR_TONES.harmonic, 0.5)],
    ['samples/legato.wav', tone(GUITAR_TONES.legato, 0.5)],
    ['samples/release.wav', tone(GUITAR_TONES.release, 0.2)],
  ]);
  if (options.articulations) {
    contents.set('samples/dead.wav', tone(GUITAR_EXTRA_TONES.dead, 0.5));
    contents.set('samples/staccato.wav', tone(GUITAR_EXTRA_TONES.staccato, 0.5));
  }
  if (options.perFile) {
    const file = (name: string): string =>
      `<global> lokey=40 hikey=88 pitch_keycenter=69\n<region> sample=samples/${name}.wav\n`;
    contents.set('gtr_pm.sfz', new TextEncoder().encode(file('file-pm')));
    contents.set('gtr_stacc.sfz', new TextEncoder().encode(file('file-stacc')));
    contents.set('samples/file-pm.wav', tone(GUITAR_FILE_TONES.palmMute, 0.5));
    contents.set('samples/file-stacc.wav', tone(GUITAR_FILE_TONES.staccato, 0.5));
  }
  if (options.noises) {
    if (options.noises === 'file') {
      contents.set(
        'noises.sfz',
        new TextEncoder().encode(['<global> pitch_keycenter=69', ...noiseRegions(), ''].join('\n')),
      );
    }
    for (const hertz of GUITAR_NOISES.tones.flat())
      contents.set(noisePath(hertz), tone(hertz, 0.5));
  }
  if (options.selection) {
    for (const hertz of selectionTones()) contents.set(selectionPath(hertz), tone(hertz, 0.5));
  }
  const reads = new Map<string, number>();
  const files: SfzFiles = {
    read(path) {
      reads.set(path, (reads.get(path) ?? 0) + 1);
      const bytes = contents.get(path);
      return bytes === undefined
        ? Promise.reject(new Error(`No file ${path}`))
        : Promise.resolve(bytes);
    },
    size: (path) => contents.get(path)?.length,
  };
  return {
    files,
    contents,
    sfz: [
      'default.sfz',
      ...(options.perFile ? ['gtr_pm.sfz', 'gtr_stacc.sfz'] : []),
      ...(options.noises === 'file' ? ['noises.sfz'] : []),
    ],
    reads,
    entries: {
      default: 'default.sfz',
      ...(options.perFile && { palmMute: 'gtr_pm.sfz', staccato: 'gtr_stacc.sfz' }),
      ...(options.noises && {
        dead: `${options.noises === 'file' ? 'noises.sfz' : 'default.sfz'}#key:100-103`,
      }),
    },
    layers: {
      palmMute: `sw:${String(SWITCHES.palmMute)}`,
      harmonic: `sw:${String(SWITCHES.harmonic)}`,
      legato: `sw:${String(SWITCHES.legato)}`,
      ...(options.articulations && {
        dead: `sw:${String(SWITCHES.dead)}`,
        staccato: `sw:${String(SWITCHES.staccato)}`,
      }),
    },
  };
}
