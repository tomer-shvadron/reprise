// The storage contract refuses what Windows tools cannot open (see `platform/storage-path.ts`),
// so the user's file name is made safe here before it becomes a path segment.
const FORBIDDEN = /[\\/:*?"<>|]/gu;
const RESERVED_DEVICE_NAME =
  /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/iu;
const MAX_LENGTH = 120;

/** `name` as one path segment: no separators, no control characters, no Windows-reserved name. */
export function safeName(name: string): string {
  const printable = Array.from(name, (char) => (char.charCodeAt(0) < 0x20 ? '_' : char)).join('');
  let safe = printable.replace(FORBIDDEN, '_').trim();
  // Trailing dots and spaces are dropped by Windows, and a leading dot hides the file.
  safe = safe.replace(/[. ]+$/u, '').replace(/^\.+/u, '_');
  if (safe === '') safe = 'song';
  if (RESERVED_DEVICE_NAME.test(safe)) safe = `_${safe}`;
  if (safe.length > MAX_LENGTH) {
    const dot = safe.lastIndexOf('.');
    // Keep a short extension; a "name" that is all extension is cut like any other.
    const extension = dot > 0 && safe.length - dot <= 8 ? safe.slice(dot) : '';
    let head = safe.slice(0, MAX_LENGTH - extension.length);
    // Not inside a surrogate pair: a lone surrogate in a path is mangled or refused.
    if (/[\ud800-\udbff]$/u.test(head)) head = head.slice(0, -1);
    safe = head + extension;
    safe = safe.replace(/[. ]+$/u, '');
  }
  return safe;
}
