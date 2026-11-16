import type { SfzFiles } from '../sfz/pack';
import { encodeWav, sine } from '../sfz/test/encode';

export interface SyntheticSfzPack {
  files: SfzFiles;
  /** Every pack file's bytes by pack-relative path, for a snapshot or a check. */
  contents: ReadonlyMap<string, Uint8Array>;
  /** Paths of the SFZ files, `default.sfz` first. */
  sfz: readonly string[];
  /** Counts of `files.read` by path, so a test sees which tracks a load touched. */
  reads: ReadonlyMap<string, number>;
}

export interface SyntheticSfzPackOptions {
  /** Sample rate of the generated WAV files; 22,050 Hz by default. */
  sampleRate?: number;
  /** The frequency of the one-note instrument; 220 Hz by default. */
  frequency?: number;
}

/**
 * A small valid pack built in memory, so no sample is committed: `default.sfz` maps one WAV to the
 * whole keyboard and `alt.sfz` maps a second, shorter one the same way.
 */
export function syntheticSfzPack(options: SyntheticSfzPackOptions = {}): SyntheticSfzPack {
  const rate = options.sampleRate ?? 22_050;
  const text = (sample: string): Uint8Array =>
    new TextEncoder().encode(`<region> sample=${sample} lokey=0 hikey=127 pitch_keycenter=60\n`);
  const contents = new Map<string, Uint8Array>([
    ['default.sfz', text('samples/a.wav')],
    ['alt.sfz', text('samples/b.wav')],
    ['samples/a.wav', encodeWav([sine(options.frequency ?? 220, rate, 0.1)], rate)],
    ['samples/b.wav', encodeWav([sine(330, rate, 0.05)], rate)],
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
  return { files, contents, sfz: ['default.sfz', 'alt.sfz'], reads };
}
