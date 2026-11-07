/**
 * The audio half of `pnpm check:files`: every file rendered through the GM tier, then checked
 * for clean signal, complete scheduling and audible attacks. Violations travel in
 * `task.meta.check`; the test fails only when the check itself crashes.
 */
import { parseNative } from '@reprise/model';
import type { Score } from '@reprise/model';
import { describe, inject, it } from 'vitest';

import { GM_BUDGET_BYTES, MEGABYTE } from '../samples/managed-sample-source';
import { emptyRecord } from './check-meta';
import type { CheckFile, CheckRecord } from './check-meta';
import { loadGeneralUser, renderScore } from './harness';
import type { Rendered } from './harness';
import {
  audible,
  completeness,
  describeTrack,
  expectedAttacks,
  ratioStats,
  strikeTiming,
  verifyAttacks,
} from './real-file';
import { peak, signalOf } from './signal';

async function loadScore(file: CheckFile): Promise<Score> {
  const url = new URL(
    `../../../../.check-files/natives/check-audio/${String(file.index)}.reprise`,
    import.meta.url,
  );
  const response = await fetch(url);
  if (!response.ok) throw new Error(`no native document for file ${String(file.index)}`);
  return parseNative(new Uint8Array(await response.arrayBuffer())).score;
}

function signalChecks(score: Score, rendered: Rendered, record: CheckRecord): void {
  let loudest = 0;
  for (let channel = 0; channel < rendered.buffer.numberOfChannels; channel += 1) {
    const signal = signalOf(rendered.buffer, channel);
    const bad = signal.data.findIndex((value) => !Number.isFinite(value));
    if (bad >= 0) {
      record.violations.push({
        code: 'non-finite',
        message: `channel ${String(channel + 1)} holds a non-finite sample`,
        where: `${(bad / signal.sampleRate).toFixed(3)} s`,
      });
    }
    loudest = Math.max(loudest, peak(signal, 0, Number.POSITIVE_INFINITY));
  }
  record.facts['peak'] = Math.round(loudest * 1000) / 1000;
  if (loudest > 1)
    record.violations.push({
      code: 'peak-over-1',
      message: `the render peaks at ${loudest.toFixed(3)}`,
      data: { peak: loudest },
    });
  const audibleNotes = score.tracks.some(
    (track) =>
      audible(score, track) &&
      track.bars.some((bar) =>
        bar.voices.some((voice) => voice.beats.some((beat) => beat.notes.length > 0)),
      ),
  );
  if (audibleNotes && loudest <= 1e-3)
    record.violations.push({
      code: 'silent-render',
      message: 'audible notes exist but the render is silent',
    });
  if (!audibleNotes && loudest > 0)
    record.violations.push({
      code: 'sound-without-notes',
      message: 'no audible notes, yet the render is not silent',
    });
  const decoded = rendered.source?.memory().decodedBytes ?? 0;
  record.facts['decodedMiB'] = Math.round((decoded / MEGABYTE) * 10) / 10;
  record.facts['instruments'] = rendered.source?.memory().residents.length ?? 0;
  if (decoded > GM_BUDGET_BYTES) {
    record.violations.push({
      code: 'memory-over-budget',
      message: `${(decoded / MEGABYTE).toFixed(1)} MiB decoded, over the GM budget`,
    });
  }
}

function strikeChecks(score: Score, rendered: Rendered, record: CheckRecord): void {
  const trackIndex = new Map(score.tracks.map((track, i) => [track.id, i]));
  const name = (id: string): string => {
    const index = trackIndex.get(id) ?? -1;
    const track = score.tracks[index];
    return track ? describeTrack(track, index) : 'an unknown track';
  };
  const byTrack = new Map<string, number>();
  for (const miss of rendered.missed) byTrack.set(miss.track, (byTrack.get(miss.track) ?? 0) + 1);
  for (const [track, count] of byTrack) {
    record.violations.push({
      code: 'sample-missed',
      message: `${String(count)} notes skipped for an undecoded sample on ${name(track)}`,
      data: { count },
    });
  }
  const silent = new Map<string, { track: string; key: number; count: number }>();
  let zero = 0;
  for (const strike of rendered.strikes) {
    if (strike.velocity <= 0) {
      zero += 1;
      continue;
    }
    if (strike.sounded || strike.missedSample) continue;
    const key = `${strike.track}|${String(strike.key)}`;
    const entry = silent.get(key) ?? { track: strike.track, key: strike.key, count: 0 };
    entry.count += 1;
    silent.set(key, entry);
  }
  for (const { track, key, count } of silent.values()) {
    record.violations.push({
      code: 'silent-strike',
      message: `key ${String(key)} found no region on ${name(track)} (${String(count)}×)`,
      data: { key, count },
    });
  }
  if (zero > 0)
    record.violations.push({
      code: 'zero-velocity',
      message: `${String(zero)} strikes at velocity 0`,
      data: { count: zero },
    });
  const drums = new Set<number>();
  for (const strike of rendered.strikes) {
    const index = trackIndex.get(strike.track);
    if (index !== undefined && score.tracks[index]?.kind === 'drums') drums.add(strike.key);
  }
  record.facts['scheduled'] = rendered.scheduled.length;
  record.facts['strikes'] = rendered.strikes.length;
  if (drums.size > 0) record.facts['drumKeys'] = [...drums].sort((a, b) => a - b).join(' ');
}

const generalUser = await loadGeneralUser();
const files = inject('checkFiles');

describe.each(files)('$file', (file) => {
  it('audio', async ({ task }) => {
    task.meta.checkTarget = { file: file.file, check: 'audio' };
    const record = emptyRecord(file.file, 'audio');
    if (file.readError !== undefined) {
      record.skipped = 'the file did not read';
      record.summary = 'skipped: the file did not read';
      task.meta.check = record;
      return;
    }
    if (!generalUser) {
      record.violations.push({
        code: 'soundfont-missing',
        message: 'GeneralUser GS is missing; run `pnpm sounds:fetch`',
      });
      record.summary = 'the GM soundfont is missing';
      task.meta.check = record;
      return;
    }
    const score = await loadScore(file);
    const started = performance.now();
    const rendered = await renderScore(score, { instruments: generalUser, tail: 1 });
    record.facts['renderMs'] = Math.round(performance.now() - started);
    record.facts['songSeconds'] = Math.round(rendered.songSeconds * 10) / 10;
    signalChecks(score, rendered, record);
    strikeChecks(score, rendered, record);
    const scheduling = completeness(score, rendered.scheduled);
    record.violations.push(...scheduling.violations);
    record.violations.push(...strikeTiming(score, rendered.scheduled, rendered.struck));
    const clusters = expectedAttacks(score, rendered.scheduled);
    const attacks = verifyAttacks(
      signalOf(rendered.buffer, 0),
      signalOf(rendered.buffer, 1),
      clusters,
    );
    if (attacks.violation) record.violations.push(attacks.violation);
    const stats = ratioStats(attacks.ratios);
    Object.assign(record.facts, {
      clusters: attacks.clusters,
      heard: attacks.heard,
      weak: attacks.weak,
      missed: attacks.missed,
      ratioMin: Math.round(stats.min * 100) / 100,
      ratioP10: Math.round(stats.p10 * 100) / 100,
      ratioMedian: Math.round(stats.median * 100) / 100,
    });
    record.summary = `${rendered.songSeconds.toFixed(1)} s, ${String(rendered.scheduled.length)} notes scheduled, attacks ${String(attacks.heard)} heard / ${String(attacks.weak)} weak / ${String(attacks.missed)} missed; ${String(record.violations.length)} findings`;
    record.sections.push({
      title: 'Render',
      markdown: [
        `- Peak ${String(record.facts['peak'])}, ${String(record.facts['decodedMiB'])} MiB decoded, ${String(record.facts['instruments'])} instruments, rendered in ${String(record.facts['renderMs'])} ms`,
        `- Attack ratio min ${String(record.facts['ratioMin'])}, p10 ${String(record.facts['ratioP10'])}, median ${String(record.facts['ratioMedian'])}`,
        ...(record.facts['drumKeys'] === undefined
          ? []
          : [`- GM drum keys struck: ${String(record.facts['drumKeys'])}`]),
      ].join('\n'),
    });
    task.meta.check = record;
  });
});
