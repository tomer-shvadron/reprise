/** A symbol the text can use, in the order the legend lists them. */
export const LEGEND_ENTRIES = [
  ['h', 'h hammer-on'],
  ['p', 'p pull-off'],
  ['/', '/ slide up'],
  ['\\', '\\ slide down'],
  ['b', 'b bend'],
  ['pb', 'pb pre-bend'],
  ['r', 'r release'],
  ['~', '~ vibrato'],
  ['x', 'x dead note'],
  ['()', '(n) ghost note'],
  ['<>', '<n> natural harmonic'],
  ['PH', '[n]PH pinch harmonic'],
  ['[]', '[n] artificial harmonic'],
  ['t', 't tap'],
  ['s', 's slap'],
  ['P', 'P pop'],
  ['tr', 'tr trill'],
  ['PM', 'PM palm mute'],
  ['LR', 'LR let ring'],
  ['*', '* repeat'],
] as const;

export type LegendKey = (typeof LEGEND_ENTRIES)[number][0];

/** The `Legend:` paragraph for the symbols used, wrapped at `width`; empty when none was. */
export function legendLines(used: ReadonlySet<LegendKey>, width: number): string[] {
  const entries = LEGEND_ENTRIES.filter(([key]) => used.has(key)).map(([, text]) => text);
  if (entries.length === 0) return [];
  const lines: string[] = [];
  let line = 'Legend:';
  for (const [index, entry] of entries.entries()) {
    const piece = `${index === 0 ? ' ' : ', '}${entry}`;
    if (line.length + piece.length > width && line.trim() !== 'Legend:') {
      lines.push(`${line},`);
      line = `        ${entry}`;
    } else {
      line += piece;
    }
  }
  lines.push(line);
  return lines;
}
