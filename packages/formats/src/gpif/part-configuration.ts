export interface TrackNotation {
  standard: boolean;
  tab: boolean;
}

/**
 * `PartConfiguration` sits beside `score.gpif` in both the gp zip and the gpx file system and is
 * the only place Guitar Pro records whether a track shows standard notation, tablature or both.
 * Big-endian: a 32-bit count of score views, then per view a multi-rest byte, a 32-bit count of
 * track entries and one flag byte per track (1 standard, 2 tab, 4 slash, 8 numbered). The first
 * view is the full score, one entry per track in score order. A flag byte of 0 means standard
 * notation, as alphaTab's reader treats it. Returns undefined when the bytes are too short.
 */
export function readPartConfiguration(bytes: Uint8Array): TrackNotation[] | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 9 || view.getInt32(0) < 1) return undefined;
  const count = view.getInt32(5);
  if (count < 0 || 9 + count > bytes.byteLength) return undefined;
  const tracks: TrackNotation[] = [];
  for (let index = 0; index < count; index++) {
    const raw = bytes[9 + index] ?? 0;
    const flags = raw === 0 ? 1 : raw;
    tracks.push({ standard: (flags & 1) !== 0, tab: (flags & 2) !== 0 });
  }
  return tracks;
}
