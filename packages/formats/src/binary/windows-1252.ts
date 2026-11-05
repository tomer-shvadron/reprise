/**
 * Guitar Pro 3 to 5 store text in the writer's ANSI code page with no marker saying which;
 * windows-1252 is what nearly every file in the wild uses, and it decodes Latin-1 text the same.
 * Bytes 0x80 to 0x9f are the only ones that differ from Latin-1; the five it leaves undefined
 * decode to themselves, as browsers' TextDecoder does.
 */
const HIGH_CONTROL_RANGE: readonly number[] = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0x8d, 0x017d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc,
  0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];

export function decodeWindows1252(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += String.fromCharCode(
      byte >= 0x80 && byte < 0xa0 ? (HIGH_CONTROL_RANGE[byte - 0x80] ?? byte) : byte,
    );
  }
  return text;
}
