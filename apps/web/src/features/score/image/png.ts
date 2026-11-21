/**
 * A `pHYs` chunk for a PNG, so a 2x image places at the page's physical size in documents and in
 * Inkscape: the SVG's px are at 96 dpi, and a PNG at scale `s` holds `96 * s` dpi.
 */
const SIGNATURE_AND_IHDR = 8 + 25;
const METRES_PER_INCH = 0.0254;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** `png` with a `pHYs` chunk after `IHDR`; the input is returned unchanged when it is not a PNG. */
export function withDpi(png: Uint8Array, dpi: number): Uint8Array {
  const isPng = png.length >= SIGNATURE_AND_IHDR && png[1] === 0x50 && png[2] === 0x4e;
  if (!isPng) return png;
  const perMetre = Math.round(dpi / METRES_PER_INCH);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, perMetre);
  view.setUint32(12, perMetre);
  chunk[16] = 1; // the unit is the metre
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, SIGNATURE_AND_IHDR));
  out.set(chunk, SIGNATURE_AND_IHDR);
  out.set(png.subarray(SIGNATURE_AND_IHDR), SIGNATURE_AND_IHDR + chunk.length);
  return out;
}
