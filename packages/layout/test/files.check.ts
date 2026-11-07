/**
 * The layout half of `pnpm check:files`: every file laid out on A4 pages in tab, standard and
 * both, checked against the invariants of `../src/test/check-result`. Violations travel in
 * `task.meta.check`; the test fails only when the check itself crashes.
 */
import { midiNote, parseNative } from '@reprise/model';
import type { Id, Notation, Score } from '@reprise/model';
import { describe, inject, it } from 'vitest';

import { DEFAULT_MARGINS, PAGE_SIZES, layout } from '../src/index';
import type { Anchor, LayoutResult } from '../src/index';
import {
  nonFinite,
  outsideItsPage,
  overlappingAnchors,
  overlappingMarks,
} from '../src/test/check-result';
import { emptyRecord } from './check-meta';
import type { CheckFile, CheckRecord, CheckViolation } from './check-meta';

const NOTATIONS: readonly Notation[] = ['tab', 'standard', 'both'];
const MARGINS = DEFAULT_MARGINS.paged;
const MAX_WHERE = 3;

interface NotePlace {
  track: number;
  bar: number;
  voice: number;
  beat: number;
  midi: number | undefined;
}

function notePlaces(score: Score): Map<Id, NotePlace> {
  const places = new Map<Id, NotePlace>();
  score.tracks.forEach((track, t) => {
    track.bars.forEach((bar, b) => {
      bar.voices.forEach((voice, v) => {
        voice.beats.forEach((beat, i) => {
          for (const note of beat.notes) {
            let midi: number | undefined;
            try {
              midi = midiNote(track, note);
            } catch {
              midi = undefined;
            }
            places.set(note.id, { track: t, bar: b, voice: v, beat: i, midi });
          }
        });
      });
    });
  });
  return places;
}

function isUnison(a: Anchor, b: Anchor, places: ReadonlyMap<Id, NotePlace>): boolean {
  if (a.kind !== 'note' || b.kind !== 'note' || a.staff !== 'standard') return false;
  const [x, y] = [places.get(a.id), places.get(b.id)];
  return (
    x !== undefined &&
    y !== undefined &&
    x.track === y.track &&
    x.bar === y.bar &&
    x.voice === y.voice &&
    x.beat === y.beat &&
    x.midi !== undefined &&
    x.midi === y.midi
  );
}

function barsOf(result: LayoutResult, system: number): string {
  const bars = result.systems[system]?.bars;
  return bars ? `bars ${String(bars.start + 1)}–${String(bars.end)}` : 'bars ?';
}

/** Violations of one kind, folded to one per group with a count and the first places. */
class Folder {
  readonly #groups = new Map<
    string,
    { violation: CheckViolation; count: number; where: string[] }
  >();

  add(key: string, violation: CheckViolation, where: string): void {
    const group = this.#groups.get(key) ?? { violation, count: 0, where: [] };
    group.count += 1;
    if (group.where.length < MAX_WHERE) group.where.push(where);
    this.#groups.set(key, group);
  }

  list(): CheckViolation[] {
    return [...this.#groups.values()].map(({ violation, count, where }) => ({
      ...violation,
      message: `${violation.message} (${String(count)}×)`,
      where: where.join('; '),
      data: { ...violation.data, count },
    }));
  }
}

function check(
  score: Score,
  notation: Notation,
  record: CheckRecord,
  places: ReadonlyMap<Id, NotePlace>,
): void {
  const started = performance.now();
  let result: LayoutResult;
  try {
    result = layout(score, {
      mode: 'paged',
      width: PAGE_SIZES.a4.width,
      pageHeight: PAGE_SIZES.a4.height,
      zoom: 1,
      tracks: 'all',
      notation: Object.fromEntries(score.tracks.map((track) => [track.id, notation])),
      margins: MARGINS,
    });
  } catch (error) {
    record.violations.push({
      code: 'layout-threw',
      message: error instanceof Error ? error.message : String(error),
      data: { notation },
    });
    return;
  }
  const ms = performance.now() - started;
  record.facts[`${notation}.pages`] = result.pages.length;
  record.facts[`${notation}.systems`] = result.systems.length;
  record.facts[`${notation}.primitives`] = result.primitives.length;
  record.facts[`${notation}.layoutMs`] = Math.round(ms);

  const bad = nonFinite(result);
  if (bad.length > 0) {
    record.violations.push({
      code: 'non-finite',
      message: `${String(bad.length)} non-finite numbers`,
      where: bad.slice(0, MAX_WHERE).join('; '),
      data: { notation, count: bad.length },
    });
  }
  for (const overflow of outsideItsPage(result, MARGINS)) {
    const where = `page ${String(overflow.page + 1)}, system ${String(overflow.system + 1)}, ${barsOf(result, overflow.system)}`;
    const count = overflow.primitives + overflow.anchors;
    const bars = result.systems[overflow.system]?.bars;
    if (count > 0) {
      record.violations.push({
        code: 'outside-page',
        message: `${String(count)} primitives and anchors outside the page in ${notation}, by up to ${overflow.overflowPx.toFixed(1)} px`,
        where,
        data: {
          notation,
          count,
          overflowPx: Math.round(overflow.overflowPx * 10) / 10,
          systemOverflowPx: Math.round(overflow.systemOverflowPx * 10) / 10,
          systemBars: bars ? bars.end - bars.start : 0,
        },
      });
    }
    if (overflow.marginOverflowPx > 0) {
      record.violations.push({
        code: 'outside-margins',
        message: `the system crosses the top or bottom margin by ${overflow.marginOverflowPx.toFixed(1)} px`,
        where,
        data: { notation, marginOverflowPx: Math.round(overflow.marginOverflowPx * 10) / 10 },
      });
    }
  }
  const anchors = new Folder();
  for (const [a, b] of overlappingAnchors(result)) {
    const unison = isUnison(a, b, places);
    const staff = a.staff ?? 'none';
    const place = places.get(a.id);
    const where = place
      ? `bar ${String(place.bar + 1)}, track ${String(place.track + 1)}, beat ${String(place.beat + 1)}`
      : `system ${String(a.system + 1)}, ${barsOf(result, a.system)}`;
    anchors.add(
      `${a.kind}|${staff}|${String(unison)}`,
      {
        code: 'overlapping-anchors',
        message: `overlapping ${a.kind} anchors on ${staff} staves in ${notation}`,
        data: { group: a.kind, notation, kind: a.kind, staff, unison },
      },
      where,
    );
  }
  record.violations.push(...anchors.list());
  const marks = new Folder();
  for (const [a, b] of overlappingMarks(result)) {
    const system = result.systems.findIndex(
      (candidate) =>
        a.bbox.y >= candidate.bbox.y &&
        a.bbox.y <= candidate.bbox.y + candidate.bbox.height &&
        a.bbox.x >= candidate.bbox.x,
    );
    marks.add(
      `${a.kind}|${b.kind}`,
      {
        code: 'overlapping-marks',
        message: `overlapping ${a.kind} and ${b.kind} marks in ${notation}`,
        data: { notation },
      },
      system >= 0 ? `system ${String(system + 1)}, ${barsOf(result, system)}` : 'system ?',
    );
  }
  record.violations.push(...marks.list());
}

async function loadScore(file: CheckFile): Promise<Score> {
  const url = new URL(
    `../../../.check-files/natives/check-layout/${String(file.index)}.reprise`,
    import.meta.url,
  );
  const response = await fetch(url);
  if (!response.ok) throw new Error(`no native document for file ${String(file.index)}`);
  return parseNative(new Uint8Array(await response.arrayBuffer())).score;
}

const files = inject('checkFiles');

describe.each(files)('$file', (file) => {
  it('layout', async ({ task }) => {
    task.meta.checkTarget = { file: file.file, check: 'layout' };
    const record = emptyRecord(file.file, 'layout');
    if (file.readError !== undefined) {
      record.skipped = 'the file did not read';
      record.summary = 'skipped: the file did not read';
      task.meta.check = record;
      return;
    }
    const score = await loadScore(file);
    const places = notePlaces(score);
    for (const notation of NOTATIONS) check(score, notation, record, places);
    const pages = NOTATIONS.map(
      (notation) => `${String(record.facts[`${notation}.pages`] ?? '?')} ${notation}`,
    );
    record.summary = `A4 pages: ${pages.join(', ')}; ${String(record.violations.length)} findings`;
    task.meta.check = record;
  });
});
