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

export interface SyntheticGuitarPackOptions {
  /** Sample rate of the generated WAV files; 22,050 Hz by default. */
  sampleRate?: number;
}

const SWITCHES = { default: 24, palmMute: 25, harmonic: 26, legato: 27 } as const;
const LABELS = {
  default: 'Sustain',
  palmMute: 'Palm Mute',
  harmonic: 'Natural Harmonic',
  legato: 'Hammer-on',
} as const;

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
