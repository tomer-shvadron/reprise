/**
 * The power of attack verification, pinned in `pnpm test`: a real GM render of a riff shaped
 * like a palm-muted metal part passes, and the same render with notes removed or a track muted
 * fails, so a retune that deafens the check or blinds it to dark attacks breaks here.
 */
import { describe, expect, inject, it } from 'vitest';

import { parseNative } from '@reprise/model';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

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

const generalUser = await loadGeneralUser();
if (!generalUser) {
  console.warn('GeneralUser GS is not present; run `pnpm sounds:fetch` to include these tests.');
}

/** Half the usual rate keeps the renders short; the detector's bands scale with it. */
const SAMPLE_RATE = 22_050;

async function render(
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

function verify(rendered: Rendered, clusters: readonly Cluster[]) {
  return verifyAttacks(signalOf(rendered.buffer, 0), signalOf(rendered.buffer, 1), clusters);
}

/**
 * Four bars at 200 BPM on a distortion guitar: a quarter (a power chord from bar 3), then six
 * eighths, palm-muted low strings alternating with unmuted notes on string 2, mostly in pairs
 * at one pitch. `mutedAs: 'rest'` turns every palm-muted note into a rest.
 */
function riff(mutedAs: 'note' | 'rest' = 'note'): Score {
  const eighths: readonly (readonly [number, number, boolean])[] = [
    [6, 0, true],
    [2, 3, false],
    [6, 0, true],
    [6, 0, true],
    [2, 5, false],
    [5, 2, true],
  ];
  let builder = score().tempo(200).track('guitar', { program: 30 });
  for (let bar = 0; bar < 4; bar += 1) {
    builder = builder.bar();
    builder = builder.beat(
      '4',
      bar < 2 ? [note(4, 2, { dynamics: 'f' })] : [note(4, 2, { dynamics: 'f' }), note(3, 4)],
    );
    for (const [string, fret, palmMute] of eighths) {
      builder =
        palmMute && mutedAs === 'rest'
          ? builder.rest('8')
          : builder.beat('8', [note(string, fret, { palmMute, dynamics: 'f' })]);
    }
  }
  return builder.build();
}

describe.skipIf(!generalUser)('attack verification on a GM render', () => {
  it('passes a palm-muted riff with every attack heard', async () => {
    const song = riff();
    const rendered = await render(song);
    const attacks = verify(rendered, expectedAttacks(song, rendered.scheduled, rendered.struck));
    expect(attacks.clusters).toBe(28);
    expect(attacks.violation).toBeUndefined();
    expect(attacks.missed).toBe(0);
  });

  it('fails the same riff with its palm-muted notes removed', async () => {
    const song = riff();
    const clusters = expectedAttacks(song, ...scheduledOf(await render(song)));
    const rendered = await render(riff('rest'));
    expect(verify(rendered, clusters).violation?.code).toBe('attack-missed');
  });

  it('fails the riff with its track muted from bar 2', async () => {
    const song = riff();
    const clusters = expectedAttacks(song, ...scheduledOf(await render(song)));
    const muted = structuredClone(song);
    const [first] = muted.tracks;
    if (first) first.channel.mute = true;
    // Bar 2 starts 1.2 s into the song, 0.1 s after play.
    const rendered = await render(song, {
      actions: [
        {
          at: 1.3,
          run: (engine) => {
            engine.load(muted);
          },
        },
      ],
    });
    const attacks = verify(rendered, clusters);
    expect(attacks.violation?.code).toBe('attack-missed');
    expect(attacks.missed).toBeGreaterThanOrEqual(ATTACK_THRESHOLDS.consecutive);
  });

  it('reads a note removed after silence as missed', async () => {
    const build = (second: boolean): Score => {
      const builder = score()
        .tempo(120)
        .track('guitar', { program: 30 })
        .bar()
        .beat('4', [note(3, 2)])
        .rest('4')
        .rest('4')
        .rest('4')
        .bar();
      return (second ? builder.beat('4', [note(4, 2)]) : builder.rest('4'))
        .rest('4')
        .rest('4')
        .rest('4')
        .build();
    };
    const whole = build(true);
    const clusters = expectedAttacks(whole, ...scheduledOf(await render(whole)));
    expect(clusters).toHaveLength(2);
    const attacks = verify(await render(build(false)), clusters);
    expect(attacks.ratios[0]).toBeGreaterThanOrEqual(ATTACK_THRESHOLDS.heard);
    expect(attacks.ratios[1]).toBeLessThan(ATTACK_THRESHOLDS.missed);
  });
});

function scheduledOf(rendered: Rendered): [Rendered['scheduled'], Rendered['struck']] {
  return [rendered.scheduled, rendered.struck];
}

/** The fixtures a knockout runs on: a drum kit and a file of effects, so dark and bright attacks. */
const KNOCKOUT = ['gp/drum-tabs.gp', 'gp5/effects.gp5'];

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

describe.skipIf(!generalUser)('attack verification on the fixtures', () => {
  for (const path of KNOCKOUT) {
    it(
      `${path} passes untouched and fails with every 10th cluster knocked out`,
      { timeout: 60_000 },
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
});
