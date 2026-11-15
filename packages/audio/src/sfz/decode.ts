/**
 * Reading a sample file's own rate and decoding it at that rate. `decodeAudioData` resamples to
 * its context's rate, and SFZ loop points and offsets are frames of the file, so the buffer must
 * keep the file's rate for `frames / buffer.sampleRate` to be exact. The rate is a few header
 * bytes: sniffing it needs no Web Audio, which the real-pack check relies on.
 */

export type SampleFormat = 'wav' | 'flac' | 'ogg';

export interface SampleHeader {
  format: SampleFormat;
  sampleRate: number;
  channels: number;
}

/** The part of an `AudioBuffer` the pack reads, so a test decoder need not build a real one. */
export interface DecodedAudio {
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  readonly length: number;
  getChannelData(channel: number): Float32Array;
}

export type SfzDecoder = (bytes: Uint8Array, sampleRate: number) => Promise<DecodedAudio>;

/** Chromium's `OfflineAudioContext` accepts 3 kHz to 768 kHz; below this nothing real remains. */
const MIN_RATE = 3000;
const MAX_RATE = 768_000;

const ascii = (bytes: Uint8Array, at: number, length: number): string =>
  String.fromCodePoint(...bytes.subarray(at, at + length));

function wavHeader(bytes: Uint8Array): SampleHeader | undefined {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    if (ascii(bytes, at, 4) === 'fmt ') {
      if (size < 16 || at + 8 + 16 > bytes.length) return undefined;
      return {
        format: 'wav',
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
      };
    }
    at += 8 + size + (size % 2);
  }
  return undefined;
}

function flacHeader(bytes: Uint8Array): SampleHeader | undefined {
  // "fLaC", then the STREAMINFO block header (type 0, 34 bytes), whose rate is a 20-bit field.
  if (ascii(bytes, 0, 4) !== 'fLaC' || bytes.length < 8 + 21) return undefined;
  if (((bytes[4] ?? 0) & 0x7f) !== 0) return undefined;
  const b18 = bytes[18] ?? 0;
  const b19 = bytes[19] ?? 0;
  const b20 = bytes[20] ?? 0;
  return {
    format: 'flac',
    sampleRate: (b18 << 12) | (b19 << 4) | (b20 >> 4),
    channels: ((b20 >> 1) & 0x7) + 1,
  };
}

function oggHeader(bytes: Uint8Array): SampleHeader | undefined {
  if (ascii(bytes, 0, 4) !== 'OggS' || bytes.length < 27) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const payload = 27 + (bytes[26] ?? 0);
  if (ascii(bytes, payload + 1, 6) === 'vorbis' && bytes[payload] === 1) {
    if (payload + 16 > bytes.length) return undefined;
    return {
      format: 'ogg',
      channels: bytes[payload + 11] ?? 0,
      sampleRate: view.getUint32(payload + 12, true),
    };
  }
  if (ascii(bytes, payload, 8) === 'OpusHead') {
    // Opus always decodes at 48 kHz, whatever rate the encoder was fed.
    return { format: 'ogg', channels: bytes[payload + 9] ?? 0, sampleRate: 48_000 };
  }
  return undefined;
}

/**
 * The format, rate and channel count from a file's first bytes (a few hundred are enough unless
 * a WAV puts large chunks before `fmt `). Throws on a format Chromium would decode but this
 * loader does not take (MP3, AIFF, ...) and on a rate it cannot build a context for.
 */
export function sniffSampleHeader(bytes: Uint8Array): SampleHeader {
  const header = wavHeader(bytes) ?? flacHeader(bytes) ?? oggHeader(bytes);
  if (!header) throw new Error('Unsupported sample format: expected WAV, FLAC or Ogg');
  if (header.sampleRate < MIN_RATE || header.sampleRate > MAX_RATE || header.channels < 1) {
    throw new Error(
      `Unsupported sample header: ${String(header.sampleRate)} Hz, ${String(header.channels)} channels`,
    );
  }
  return header;
}

const contexts = new Map<number, OfflineAudioContext>();

/** `decodeAudioData` at `sampleRate`, on a one-frame offline context kept per rate. */
export async function decodeAtNativeRate(
  bytes: Uint8Array,
  sampleRate: number,
): Promise<AudioBuffer> {
  let context = contexts.get(sampleRate);
  if (!context) {
    context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate });
    contexts.set(sampleRate, context);
  }
  // decodeAudioData detaches its input, and the caller may keep the bytes (a cache, a retry).
  return context.decodeAudioData(bytes.slice().buffer);
}
