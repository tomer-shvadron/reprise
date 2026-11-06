import type { Format } from './format';

function startsWith(bytes: Uint8Array, ascii: string, offset = 0): boolean {
  if (bytes.length < offset + ascii.length) return false;
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

const BINARY_PREFIX = '\u0018FICHIER GUITAR PRO ';
const BINARY_MAJORS: Readonly<Record<string, Format>> = { '3': 'gp3', '4': 'gp4', '5': 'gp5' };

const WHITESPACE = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** Whether the bytes open with a JSON object, past an optional BOM and leading whitespace. */
function opensJsonObject(bytes: Uint8Array): boolean {
  let at = startsWith(bytes, '\u00ef\u00bb\u00bf') ? 3 : 0;
  while (at < bytes.length && WHITESPACE.has(bytes[at] ?? 0)) at++;
  return bytes[at] === 0x7b;
}

/**
 * The format the bytes are, by their signature alone. The binary family is told apart by the
 * major version digit only, so an unknown minor (`v5.20`) still detects and the reader names it.
 */
export function detect(bytes: Uint8Array): Format | undefined {
  if (startsWith(bytes, BINARY_PREFIX) && startsWith(bytes, '.', BINARY_PREFIX.length + 2)) {
    const major = bytes[BINARY_PREFIX.length + 1];
    return major === undefined ? undefined : BINARY_MAJORS[String.fromCharCode(major)];
  }
  if (startsWith(bytes, 'PK\u0003\u0004')) return 'gp';
  if (startsWith(bytes, 'BCFZ') || startsWith(bytes, 'BCFS')) return 'gpx';
  if (opensJsonObject(bytes)) return 'reprise';
  return undefined;
}
