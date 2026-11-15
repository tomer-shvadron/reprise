/**
 * In-memory sample files for the tests, so no audio bytes are committed: PCM WAV, and FLAC with
 * verbatim subframes (a valid stream that every decoder reads, with no compression to get wrong).
 */

export type BitDepth = 16 | 24;

/** Float samples in -1..1 as signed integers of the depth, the values a decoder should return. */
export function quantize(channel: Float32Array, bits: BitDepth): Int32Array {
  const scale = 2 ** (bits - 1) - 1;
  return Int32Array.from(channel, (value) => Math.round(Math.max(-1, Math.min(1, value)) * scale));
}

export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bits: BitDepth = 16,
): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bits / 8;
  const dataBytes = frames * channels.length * bytesPerSample;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);
  const tag = (at: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) out[at + i] = text.codePointAt(i) ?? 0;
  };
  tag(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * bytesPerSample, true);
  view.setUint16(32, channels.length * bytesPerSample, true);
  view.setUint16(34, bits, true);
  tag(36, 'data');
  view.setUint32(40, dataBytes, true);
  const ints = channels.map((channel) => quantize(channel, bits));
  let at = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (const channel of ints) {
      const value = channel[frame] ?? 0;
      if (bits === 16) view.setInt16(at, value, true);
      else {
        out[at] = value & 0xff;
        out[at + 1] = (value >> 8) & 0xff;
        out[at + 2] = (value >> 16) & 0xff;
      }
      at += bytesPerSample;
    }
  }
  return out;
}

function crc8(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

function crc16(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** One FLAC frame holds every sample, so a clip is at most 65,535 frames. */
export function encodeFlac(
  channels: readonly Float32Array[],
  sampleRate: number,
  bits: BitDepth = 16,
): Uint8Array {
  const frames = channels[0]?.length ?? 0;
  if (frames < 16 || frames > 65_535) throw new RangeError('A test FLAC holds 16..65535 frames');
  const out: number[] = [0x66, 0x4c, 0x61, 0x43]; // "fLaC"
  // STREAMINFO: last-block flag, type 0, 34 bytes; block sizes, frame sizes (unknown = 0), then
  // 20-bit rate, 3-bit channels - 1, 5-bit depth - 1, 36-bit total frames, 16 bytes of MD5.
  out.push(
    0x80,
    0,
    0,
    34,
    frames >> 8,
    frames & 0xff,
    frames >> 8,
    frames & 0xff,
    0,
    0,
    0,
    0,
    0,
    0,
  );
  const packed =
    (BigInt(sampleRate) << 44n) |
    (BigInt(channels.length - 1) << 41n) |
    (BigInt(bits - 1) << 36n) |
    BigInt(frames);
  for (let shift = 56n; shift >= 0n; shift -= 8n) out.push(Number((packed >> shift) & 0xffn));
  for (let i = 0; i < 16; i += 1) out.push(0);

  // Frame header: sync 0xFFF8 (fixed block size), 16-bit block size, rate from STREAMINFO,
  // independent channels, the depth, frame number 0.
  const header = [
    0xff,
    0xf8,
    0x70,
    ((channels.length - 1) << 4) | ((bits === 16 ? 0b100 : 0b110) << 1),
    0x00,
    (frames - 1) >> 8,
    (frames - 1) & 0xff,
  ];
  header.push(crc8(header));
  const frame = [...header];
  for (const channel of channels) {
    frame.push(0x02); // verbatim subframe, no wasted bits
    for (const value of quantize(channel, bits)) {
      if (bits === 24) frame.push((value >> 16) & 0xff);
      frame.push((value >> 8) & 0xff, value & 0xff);
    }
  }
  const footer = crc16(frame);
  frame.push(footer >> 8, footer & 0xff);
  return Uint8Array.from([...out, ...frame]);
}

/** A sine as float samples, for generated files. */
export function sine(
  frequency: number,
  sampleRate: number,
  seconds: number,
  amplitude = 0.5,
): Float32Array {
  const frames = Math.round(sampleRate * seconds);
  return Float32Array.from(
    { length: frames },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate),
  );
}
