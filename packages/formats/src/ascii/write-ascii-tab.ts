import { canShowTab, type Id, type Score, type Track } from '@reprise/model';

import { FormatError } from '../errors';
import type { Warning } from '../warnings';

import { bpmText, tempoAt, type BlockContext } from './bars';
import { AsciiDropCollector } from './dropped';
import { stringLabels } from './labels';
import { legendLines, type LegendKey } from './legend';
import { renderSystems } from './lines';
import { singleLine } from './text';

export interface AsciiTabOptions {
  /** Tracks to write, by id, written in score order; at least one. Drum and pitched tracks are skipped and reported. */
  tracks: readonly Id[];
  /** Master-bar indices, end exclusive; the whole score when absent. */
  bars?: { start: number; end: number };
  /** Longest line, in characters (code points); 40 to 400, default 80. */
  width?: number;
}

export interface AsciiTabResult {
  text: string;
  /** What the text leaves out, folded by code like the gp writer's `dropped`. */
  dropped: Warning[];
}

export const ASCII_TAB_WIDTH = { min: 40, max: 400, default: 80 } as const;

function blockHeader(score: Score, track: Track, index: number, start: number): string {
  const parts = [singleLine(track.name) || `Track ${String(index + 1)}`];
  const { tuning } = stringLabels(track.tuning);
  parts.push(`Tuning: ${tuning.join(' ')}`);
  if (track.capo > 0) parts.push(`Capo ${String(track.capo)}`);
  const bpm = tempoAt(score, start);
  if (bpm !== undefined) parts.push(`${bpmText(bpm)} bpm`);
  return parts.join(' | ');
}

function toWarning(dropped: AsciiDropCollector['dropped'][number]): Warning {
  const { code, message, location, path, count } = dropped;
  return {
    code,
    severity: 'info',
    message,
    location: { ...location, path },
    ...(count > 1 ? { count } : {}),
  };
}

/**
 * Writes tracks as plain-text tab, the kind posted in forums: one line per string, frets in
 * columns, bars between `|`.
 *
 * What the text holds, per track block: a header line (name, tuning low to high, capo, the first
 * bar's tempo), then systems of whole bars wrapped at `width`. Voice 1 only. Beats are spaced by
 * duration within a bar (a quarter is four times a sixteenth) and two-digit frets are aligned,
 * but rhythm is otherwise not marked. Above the strings: chord names, beat text, and an
 * annotation row (the bar number at each line's start, sections, a changed time signature or
 * tempo, volta numbers, jumps, `x3` at a repeat end). Below: palm-mute and let-ring runs and lyric
 * line 1. A row appears on a line only when it has something. A legend of the symbols used ends
 * the text. A tied note is dashes; a trill is `7tr9`.
 *
 * Absent by the format's convention and not reported: rhythm and tuplets, dynamics, accents,
 * staccato, fingering, fades, volume swells, key signatures, clefs and mixer changes. What a
 * reader would expect and will not find is reported in `dropped` (see `AsciiDropCode`).
 *
 * Output is ASCII except the user's own text (titles, chord names, lyrics). Widths count code
 * points, so East Asian wide characters can misalign; that is accepted.
 *
 * Throws `FormatError` `unsupported-track` when none of the tracks has strings (a drum or pitched
 * track alone), and `RangeError` for a bad `width` or `bars` or an unknown track id.
 */
export function writeAsciiTab(score: Score, options: AsciiTabOptions): AsciiTabResult {
  const width = options.width ?? ASCII_TAB_WIDTH.default;
  if (!Number.isInteger(width) || width < ASCII_TAB_WIDTH.min || width > ASCII_TAB_WIDTH.max) {
    throw new RangeError(
      `width must be a whole number from ${String(ASCII_TAB_WIDTH.min)} to ${String(ASCII_TAB_WIDTH.max)}, got ${String(width)}`,
    );
  }
  const range = options.bars ?? { start: 0, end: score.masterBars.length };
  if (
    !Number.isInteger(range.start) ||
    !Number.isInteger(range.end) ||
    range.start < 0 ||
    range.end > score.masterBars.length ||
    range.start >= range.end
  ) {
    throw new RangeError(
      `bars must satisfy 0 <= start < end <= ${String(score.masterBars.length)}, got ${String(range.start)} to ${String(range.end)}`,
    );
  }
  if (options.tracks.length === 0) throw new RangeError('tracks must name at least one track');
  for (const id of options.tracks) {
    if (!score.tracks.some((track) => track.id === id)) {
      throw new RangeError(`unknown track ${id}`);
    }
  }
  const wanted = score.tracks.flatMap((track, index) =>
    options.tracks.includes(track.id) ? [{ track, index }] : [],
  );
  const written = wanted.filter(({ track }) => canShowTab(track));
  const [firstWanted] = wanted;
  if (written.length === 0 && firstWanted) {
    throw new FormatError(
      'unsupported-track',
      `Track "${firstWanted.track.name}" has no strings: ASCII tab needs a fretted track`,
    );
  }

  const drops = new AsciiDropCollector();
  for (const { index } of wanted.filter(({ track }) => !canShowTab(track))) {
    drops.drop('track-skipped', { track: index });
  }
  const used = new Set<LegendKey>();
  const lines: string[] = [];
  const heading = [score.meta.title, score.meta.artist]
    .map(singleLine)
    .filter((part) => part !== '');
  if (heading.length > 0) lines.push(heading.join(' - '));
  written.forEach(({ track, index }, position) => {
    if (position > 0) lines.push('');
    const ctx: BlockContext = { score, trackIndex: index, track, range, drops, used };
    lines.push(
      blockHeader(score, track, index, range.start),
      '',
      ...renderSystems(ctx, stringLabels(track.tuning).lines, width),
    );
  });
  const legend = legendLines(used, width);
  if (legend.length > 0) lines.push('', ...legend);
  return { text: `${lines.join('\n')}\n`, dropped: drops.dropped.map(toWarning) };
}
