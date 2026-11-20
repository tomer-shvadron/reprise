/**
 * Shared by the attack-verification test files, split so Vitest runs the slow GM renders in
 * parallel; see attack-verification.test.ts for what they pin.
 */
import { expect, inject, it } from 'vitest';

import { parseNative } from '@reprise/model';
import type { Score } from '@reprise/model';

import { loadGeneralUser, renderScore } from './harness';
import type { RenderOptions, Rendered } from './harness';
import { ATTACK_THRESHOLDS, expectedAttacks, verifyAttacks } from './real-file';
import type { Cluster } from './real-file';
import { signalOf } from './signal';

interface ScoreFixture {
  path: string;
  native: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: ScoreFixture[];
  }
}

export const generalUser = await loadGeneralUser();
if (!generalUser) {
  console.warn('GeneralUser GS is not present; run `pnpm sounds:fetch` to include these tests.');
}

/** The harness rate `pnpm check:files` renders at, so the frame, hop and lag are the real ones. */
const SAMPLE_RATE = 44_100;

export async function render(
  song: Score,
  options: { tail?: number; actions?: RenderOptions['actions'] } = {},
): Promise<Rendered> {
  if (!generalUser) throw new Error('GeneralUser GS is missing');
  return renderScore(song, {
    instruments: generalUser,
    sampleRate: SAMPLE_RATE,
    tail: options.tail ?? 1,
    ...(options.actions && { actions: options.actions }),
  });
}

export function verify(rendered: Rendered, clusters: readonly Cluster[]) {
  return verifyAttacks(signalOf(rendered.buffer, 0), signalOf(rendered.buffer, 1), clusters);
}

export function scheduledOf(rendered: Rendered): [Rendered['scheduled'], Rendered['struck']] {
  return [rendered.scheduled, rendered.struck];
}

/** Every 10th cluster's notes (all those starting within its window) removed, rhythm kept. */
function knockOut(song: Score, rendered: Rendered, clusters: readonly Cluster[]): Score {
  const copy = structuredClone(song);
  const gone = new Set<string>();
  clusters.forEach((cluster, index) => {
    if (index % 10 !== 5) return;
    for (const event of rendered.scheduled) {
      if (Math.abs(event.when - cluster.event.when) <= ATTACK_THRESHOLDS.clusterSeconds) {
        gone.add(event.note.id);
      }
    }
  });
  for (const track of copy.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          beat.notes = beat.notes.filter((candidate) => !gone.has(candidate.id));
          if (beat.notes.length === 0) beat.rest = true;
        }
      }
    }
  }
  return copy;
}

/**
 * One fixture's knockout case, named by its path. The fixtures are a drum kit and a file of
 * effects, so dark and bright attacks; each has its own file to run in parallel. The timeout is
 * 4 times the worst CI run (19 s), rounded up to 120 s.
 */
export function knockoutCase(path: string): void {
  it(
    `${path} passes untouched and fails with every 10th cluster knocked out`,
    { timeout: 120_000 },
    async () => {
      const fixture = inject('scoreFixtures').find((candidate) => candidate.path === path);
      if (!fixture) throw new Error(`${path} is not in the corpus`);
      const { score: song } = parseNative(new TextEncoder().encode(fixture.native));
      const rendered = await render(song, { tail: 0.5 });
      const clusters = expectedAttacks(song, rendered.scheduled, rendered.struck);
      expect(verify(rendered, clusters).violation).toBeUndefined();
      const knocked = await render(knockOut(song, rendered, clusters), { tail: 0.5 });
      expect(verify(knocked, clusters).violation?.code).toBe('attack-missed');
    },
  );
}
