export type Format = 'gp3' | 'gp4' | 'gp5' | 'gp' | 'gpx' | 'reprise';

export const FORMATS: readonly Format[] = ['gp3', 'gp4', 'gp5', 'gp', 'gpx', 'reprise'];

function isFormat(text: string): text is Format {
  return FORMATS.some((format) => format === text);
}

/**
 * What a file name's extension claims (`Song.GP5` is `gp5`), or undefined. `detect` and `read`
 * never consult it: the bytes decide, and this is only a fallback for a caller that has a name.
 */
export function formatOfExtension(name: string): Format | undefined {
  const base = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return undefined;
  const extension = base.slice(dot + 1).toLowerCase();
  return isFormat(extension) ? extension : undefined;
}
