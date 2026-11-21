import type { NoteTable } from './note-table';

/** Row indices of the table grouped by master bar; rows keep their table order inside a bar. */
export function rowsByBar(table: NoteTable, barCount: number): number[][] {
  const bars: number[][] = Array.from({ length: barCount }, () => []);
  for (let i = 0; i < table.length; i++) bars[table.bar[i] ?? 0]?.push(i);
  return bars;
}

/** The rows of `table` at `indices`, as a table of their own (a copy, so the source is untouched). */
export function subTable(table: NoteTable, indices: readonly number[]): NoteTable {
  const length = indices.length;
  const picked: NoteTable = {
    length,
    pitch: new Uint8Array(length),
    track: new Uint16Array(length),
    bar: new Uint32Array(length),
    voice: new Uint8Array(length),
    beat: new Uint32Array(length),
    onset: new Float64Array(length),
    duration: new Float64Array(length),
    metric: new Uint8Array(length),
    flags: new Uint8Array(length),
    tech: new Uint32Array(length),
    string: new Uint8Array(length),
    fret: new Uint8Array(length),
    passes: new Uint16Array(length),
  };
  indices.forEach((from, to) => {
    picked.pitch[to] = table.pitch[from] ?? 0;
    picked.track[to] = table.track[from] ?? 0;
    picked.bar[to] = table.bar[from] ?? 0;
    picked.voice[to] = table.voice[from] ?? 0;
    picked.beat[to] = table.beat[from] ?? 0;
    picked.onset[to] = table.onset[from] ?? 0;
    picked.duration[to] = table.duration[from] ?? 0;
    picked.metric[to] = table.metric[from] ?? 0;
    picked.flags[to] = table.flags[from] ?? 0;
    picked.tech[to] = table.tech[from] ?? 0;
    picked.string[to] = table.string[from] ?? 0;
    picked.fret[to] = table.fret[from] ?? 0;
    picked.passes[to] = table.passes[from] ?? 0;
  });
  return picked;
}

/** The bars `from` to `to` inclusive, as a list of row indices. */
export function rowsInBars(bars: readonly number[][], from: number, to: number): number[] {
  const rows: number[] = [];
  for (let bar = from; bar <= to; bar++) for (const row of bars[bar] ?? []) rows.push(row);
  return rows;
}
