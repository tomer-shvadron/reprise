import type { BarLayout, BlockContext, CloseKind, OpenKind } from './bars';
import { layoutBar } from './bars';
import { Row, length } from './text';

/**
 * The bar line between two bars, or at a line's edge when one side is absent. A repeat sign
 * `*` is printed on only two string lines; the others get a dash there.
 */
function boundary(close: CloseKind | undefined, open: OpenKind | undefined): string {
  const end = close === 'end';
  const start = open === 'start';
  if (end && start) return '*||*';
  if (end) return '*||';
  if (start) return '||*';
  return close === 'double' ? '||' : '|';
}

/** The bar's width on a line: its dashes, widened for the words written above it. */
function contentWidth(bar: BarLayout, first: boolean): number {
  const number = first ? String(bar.index + 1) : '';
  const words = [number, bar.words].filter((part) => part !== '').join(' ');
  const needed =
    length(words) + (bar.repeatCount === '' ? 0 : length(bar.repeatCount) + (words === '' ? 0 : 1));
  return Math.max(bar.width, needed);
}

/** Whole bars per line, as many as fit; a bar wider than the line stands alone. */
function breakLines(bars: readonly BarLayout[], gutter: number, width: number): BarLayout[][] {
  const lines: BarLayout[][] = [];
  let current: BarLayout[] = [];
  let used = 0;
  for (const bar of bars) {
    const previous = current.at(-1);
    if (previous === undefined) {
      current = [bar];
      used = gutter + length(boundary(undefined, bar.open)) + contentWidth(bar, true);
      continue;
    }
    const add = length(boundary(previous.close, bar.open)) + contentWidth(bar, false);
    if (used + add + length(boundary(bar.close, undefined)) <= width) {
      current.push(bar);
      used += add;
    } else {
      lines.push(current);
      current = [bar];
      used = gutter + length(boundary(undefined, bar.open)) + contentWidth(bar, true);
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

function renderLine(
  ctx: BlockContext,
  labels: readonly string[],
  bars: readonly BarLayout[],
): string[] {
  const strings = labels.length;
  const stars = new Set([Math.min(1, strings - 1), Math.max(0, strings - 2)]);
  const lines = labels.map((label) => label);
  const chords = new Row();
  const wahs = new Row();
  const texts = new Row();
  const annotations = new Row();
  const effects = new Row();
  const lyrics = new Row();
  let column = length(labels[0] ?? '');
  // A palm-mute or let-ring run goes on across bar lines; `gap` is the width of the bar line
  // and leading dash passed since its last beat, added only if the next beat continues it.
  let run: { label: 'PM' | 'LR'; start: number; width: number } | undefined;
  let gap = 0;
  const flush = (): void => {
    if (!run) return;
    const fill =
      run.width > run.label.length ? `${'-'.repeat(run.width - run.label.length - 1)} ` : '';
    effects.put(run.start, run.label + fill);
    run = undefined;
  };

  const bar = (text: string): void => {
    if (text.includes('*')) ctx.used.add('*');
    lines.forEach((line, index) => {
      lines[index] = line + text.replaceAll('*', stars.has(index) ? '*' : '-');
    });
    column += length(text);
  };

  bars.forEach((layout, position) => {
    const first = position === 0;
    const previous = bars[position - 1];
    const before = column;
    bar(first ? boundary(undefined, layout.open) : boundary(previous?.close, layout.open));
    gap += column - before;
    if (layout.cells.length === 0) flush();
    const width = contentWidth(layout, first);
    const words = [first ? String(layout.index + 1) : '', layout.words]
      .filter((part) => part !== '')
      .join(' ');
    annotations.put(column, words);
    if (layout.repeatCount !== '') {
      annotations.put(column + width - length(layout.repeatCount), layout.repeatCount);
    }
    lines.forEach((line, index) => {
      const body =
        layout.cells.length === 0
          ? ''
          : `-${layout.cells.map((cell) => (cell.tokens[index] ?? '').padEnd(cell.width, '-')).join('')}`;
      lines[index] = line + body.padEnd(width, '-');
    });
    let offset = 1;
    gap += 1;
    for (const cell of layout.cells) {
      chords.put(column + offset, cell.chord);
      if (cell.wah !== '') {
        wahs.put(column + offset, cell.wah);
        ctx.used.add(cell.wah);
      }
      texts.put(column + offset, cell.text);
      lyrics.put(column + offset, cell.lyric);
      if (cell.effect === undefined || run?.label !== cell.effect) flush();
      if (cell.effect !== undefined) {
        if (run) run.width += gap + cell.width;
        else run = { label: cell.effect, start: column + offset, width: cell.width };
        ctx.used.add(cell.effect);
      }
      gap = 0;
      offset += cell.width;
    }
    column += width;
  });
  flush();
  const last = bars.at(-1);
  bar(boundary(last?.close, undefined));

  const rows = [annotations, texts, chords, wahs].filter((row) => !row.empty).map(String);
  const below = [effects, lyrics].filter((row) => !row.empty).map(String);
  return [...rows, ...lines.map((line) => line.trimEnd()), ...below];
}

/** The track's lines of text: systems of whole bars, a blank line between them. */
export function renderSystems(
  ctx: BlockContext,
  labels: readonly string[],
  width: number,
): string[] {
  const bars: BarLayout[] = [];
  for (let index = ctx.range.start; index < ctx.range.end; index++)
    bars.push(layoutBar(ctx, index));
  const systems = breakLines(bars, length(labels[0] ?? ''), width);
  return systems.flatMap((system, index) => [
    ...(index > 0 ? [''] : []),
    ...renderLine(ctx, labels, system),
  ]);
}
