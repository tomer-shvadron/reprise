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

/** `rt_decay` of the release samples, in dB per second held. */
export const GUITAR_RELEASE_DECAY = 6;

export interface SyntheticGuitarPack extends SyntheticSfzPack {
  /** What `PackAssignment.entries` takes for it: only the default file, with its labelled layers. */
  entries: Readonly<Record<string, string>>;
  /** The keyswitch layer id the loader makes for each labelled set: `sw:<k>`. */
  layers: Readonly<{ palmMute: string; harmonic: string; legato: string }>;
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
}

const SWITCHES = { default: 24, palmMute: 25, harmonic: 26, legato: 27 } as const;
const LABELS = {
  default: 'Sustain',
  palmMute: 'Palm Mute',
  harmonic: 'Natural Harmonic',
  legato: 'Hammer-on',
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
    `<group> sw_lokey=24 sw_hikey=27 sw_default=${String(SWITCHES.default)}`,
    layerText('default'),
    layerText('palmMute'),
    layerText('harmonic'),
    layerText('legato'),
    `<region> sample=samples/release.wav trigger=release rt_decay=${String(GUITAR_RELEASE_DECAY)} loop_mode=one_shot`,
    ...(options.selection ? selectionRegions() : []),
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
    sfz: ['default.sfz'],
    reads,
    entries: { default: 'default.sfz' },
    layers: {
      palmMute: `sw:${String(SWITCHES.palmMute)}`,
      harmonic: `sw:${String(SWITCHES.harmonic)}`,
      legato: `sw:${String(SWITCHES.legato)}`,
    },
  };
}
