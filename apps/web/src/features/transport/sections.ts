import type { Score } from '@reprise/model';
import { defaultFilter } from 'cmdk';

export interface ScoreSection {
  /** 1-based bar numbers, anacrusis included, as the layout counts them. */
  startBar: number;
  endBar: number;
  startIndex: number;
  endIndex: number;
  name: string;
  letter?: string;
  /** The unique name the palette shows: duplicates are numbered in score order. */
  label: string;
}

const sections = new WeakMap<Score, readonly ScoreSection[]>();

function baseName(name: string, letter: string | undefined, bar: number): string {
  const trimmed = name.trim();
  if (trimmed !== '') return trimmed;
  return letter !== undefined && letter.trim() !== ''
    ? `Section ${letter.trim()}`
    : `Section at bar ${String(bar)}`;
}

/**
 * The score's sections in score order, not playback order: a section runs from a master bar with a
 * marker to the bar before the next marker, or to the last bar. Bars before the first marker belong
 * to none. Built once per score version, as `timelineOf` is.
 */
export function sectionsOf(score: Score): readonly ScoreSection[] {
  const cached = sections.get(score);
  if (cached) return cached;
  const starts: number[] = [];
  score.masterBars.forEach((bar, index) => {
    if (bar.section) starts.push(index);
  });
  const raw = starts.flatMap((startIndex, at) => {
    const section = score.masterBars[startIndex]?.section;
    if (!section) return [];
    const endIndex = (starts[at + 1] ?? score.masterBars.length) - 1;
    return [
      {
        startBar: startIndex + 1,
        endBar: endIndex + 1,
        startIndex,
        endIndex,
        name: baseName(section.name, section.letter, startIndex + 1),
        ...(section.letter === undefined ? {} : { letter: section.letter }),
      },
    ];
  });
  const key = (name: string) => name.toLowerCase();
  const totals = new Map<string, number>();
  for (const section of raw)
    totals.set(key(section.name), (totals.get(key(section.name)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const result = raw.map((section): ScoreSection => {
    const k = key(section.name);
    if ((totals.get(k) ?? 0) < 2) return { ...section, label: section.name };
    const ordinal = (seen.get(k) ?? 0) + 1;
    seen.set(k, ordinal);
    const label = /\d$/u.test(section.name)
      ? `${section.name} (${String(ordinal)})`
      : `${section.name} ${String(ordinal)}`;
    return { ...section, label };
  });
  sections.set(score, result);
  return result;
}

/** "Bars 17–24", or "Bar 17" for one bar. */
export function sectionBars(section: ScoreSection): string {
  return section.startBar === section.endBar
    ? `Bar ${String(section.startBar)}`
    : `Bars ${String(section.startBar)}–${String(section.endBar)}`;
}

/** The section whose bars hold `masterBarIndex`, if any. */
export function sectionAt(
  all: readonly ScoreSection[],
  masterBarIndex: number,
): ScoreSection | undefined {
  return all.find((s) => masterBarIndex >= s.startIndex && masterBarIndex <= s.endIndex);
}

export interface RankedSection {
  section: ScoreSection;
  tag?: string;
}

/**
 * Sections matching `query`: a one-character query equal to the letter first, then label prefixes,
 * then cmdk's fuzzy score; ties stay in score order. An empty query lists them all.
 */
export function rankSections(
  all: readonly ScoreSection[],
  query: string,
  playheadIndex?: number,
): RankedSection[] {
  const wanted = query.trim().toLowerCase();
  const playing = playheadIndex === undefined ? undefined : sectionAt(all, playheadIndex);
  const tagged = (section: ScoreSection): RankedSection =>
    section === playing ? { section, tag: 'Playing' } : { section };
  if (wanted === '') return all.map(tagged);
  return all
    .map((section, order) => {
      const keywords = [section.name, section.letter ?? ''];
      let score = defaultFilter(section.label, wanted, keywords);
      if (section.label.toLowerCase().startsWith(wanted)) score = Math.max(score, 2);
      if (wanted.length === 1 && section.letter?.toLowerCase() === wanted) score = 3;
      return { section, score, order };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((item) => tagged(item.section));
}
