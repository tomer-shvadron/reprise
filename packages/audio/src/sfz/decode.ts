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
  /** Frames the header declares (WAV `data` size, FLAC STREAMINFO total); undefined for Ogg. */
  frames?: number;
}

/**
 * Caps on what one sample file of an untrusted pack can make a load allocate. A FLAC of constant
 * subframes stores about 12 bytes per 65,535 frames, so file size alone does not bound the
 * decoded size; the declared size is checked before decoding and the result after.
 */
export const SAMPLE_LIMITS = {
  /** Bytes of one sample file, checked from `files.size` before the read and again after it. */
  fileBytes: 128 * 1024 * 1024,
  /** Decoded Float32 bytes of one sample file, declared and actual: inside the HQ budget. */
  decodedBytes: 256 * 1024 * 1024,
};

/** Cached offline contexts, one per rate; a pack of files claiming many rates evicts the oldest. */
const MAX_CONTEXTS = 4;

const WAV_PCM = 1;
const WAV_FLOAT = 3;
const WAV_EXTENSIBLE = 0xfffe;

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
  let fmt: { channels: number; sampleRate: number; blockAlign: number } | undefined;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    const name = ascii(bytes, at, 4);
    if (name === 'fmt ') {
      if (size < 16 || at + 8 + 16 > bytes.length) return undefined;
      const tag = view.getUint16(at + 8, true);
      // ADPCM and MP3-in-WAV turn up in old packs; Chromium does not decode them.
      if (tag !== WAV_PCM && tag !== WAV_FLOAT && tag !== WAV_EXTENSIBLE) {
        throw new Error(`Unsupported WAV format tag 0x${tag.toString(16)}: expected PCM or float`);
      }
      fmt = {
        channels: view.getUint16(at + 10, true),
        sampleRate: view.getUint32(at + 12, true),
        blockAlign: view.getUint16(at + 20, true),
      };
    } else if (name === 'data' && fmt) {
      // The file cannot decode to more than it holds, whatever the chunk claims.
      const held = Math.min(size, bytes.length - (at + 8));
      return {
        format: 'wav',
        channels: fmt.channels,
        sampleRate: fmt.sampleRate,
        ...(fmt.blockAlign > 0 && { frames: Math.floor(held / fmt.blockAlign) }),
      };
    }
    at += 8 + size + (size % 2);
  }
  // No `data` chunk in the bytes given (a head only): the rate and channels still sniff.
  return fmt && { format: 'wav', channels: fmt.channels, sampleRate: fmt.sampleRate };
}

function flacHeader(bytes: Uint8Array): SampleHeader | undefined {
  // An ID3v2 tag in front is skipped, as decoders do: 10 bytes plus a syncsafe size.
  if (ascii(bytes, 0, 3) === 'ID3' && bytes.length >= 10) {
    const size =
      ((bytes[6] ?? 0) & 0x7f) * 2 ** 21 +
      ((bytes[7] ?? 0) & 0x7f) * 2 ** 14 +
      ((bytes[8] ?? 0) & 0x7f) * 2 ** 7 +
      ((bytes[9] ?? 0) & 0x7f);
    return flacHeader(bytes.subarray(10 + size));
  }
  // "fLaC", then the STREAMINFO block header (type 0, 34 bytes), whose rate is a 20-bit field.
  if (ascii(bytes, 0, 4) !== 'fLaC' || bytes.length < 8 + 26) return undefined;
  if (((bytes[4] ?? 0) & 0x7f) !== 0) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const b18 = bytes[18] ?? 0;
  const b19 = bytes[19] ?? 0;
  const b20 = bytes[20] ?? 0;
  // 36-bit total samples: the low nibble of byte 21, then a big-endian u32. 0 means unknown.
  const total = ((bytes[21] ?? 0) & 0xf) * 2 ** 32 + view.getUint32(22, false);
  return {
    format: 'flac',
    sampleRate: (b18 << 12) | (b19 << 4) | (b20 >> 4),
    channels: ((b20 >> 1) & 0x7) + 1,
    ...(total > 0 && { frames: total }),
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

function contextFor(sampleRate: number): OfflineAudioContext {
  const cached = contexts.get(sampleRate);
  if (cached) {
    // Map order is recency: re-insert on use, evict from the front.
    contexts.delete(sampleRate);
    contexts.set(sampleRate, cached);
    return cached;
  }
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate });
  contexts.set(sampleRate, context);
  for (const oldest of contexts.keys()) {
    if (contexts.size <= MAX_CONTEXTS) break;
    contexts.delete(oldest);
  }
  return context;
}

/** `decodeAudioData` at `sampleRate`, on a one-frame offline context kept per recent rate. */
export async function decodeAtNativeRate(
  bytes: Uint8Array,
  sampleRate: number,
): Promise<AudioBuffer> {
  // decodeAudioData detaches its input, and the caller may keep the bytes (a cache, a retry).
  return contextFor(sampleRate).decodeAudioData(bytes.slice().buffer);
}
