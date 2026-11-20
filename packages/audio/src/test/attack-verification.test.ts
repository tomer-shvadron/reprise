/**
 * The power of attack verification, pinned in `pnpm test`: a real GM render of a riff shaped
 * like a palm-muted metal part passes, and the same render with notes removed or a track muted
 * fails, so a retune that deafens the check or blinds it to dark attacks breaks here.
 */
import { describe, expect, it } from 'vitest';

import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { generalUser, render, scheduledOf, verify } from './attack-verification-support';
import { START } from './harness';
import { ATTACK_THRESHOLDS, expectedAttacks } from './real-file';

/**
 * Four bars at 200 BPM on a distortion guitar: a quarter (a power chord from bar 3), then six
 * eighths, palm-muted low strings alternating with unmuted notes on string 2, mostly in pairs
 * at one pitch. `mutedAs: 'rest'` turns every palm-muted note into a rest.
 */
function riff(mutedAs: 'note' | 'rest' = 'note', silentFromBar = 4): Score {
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
    if (bar >= silentFromBar) {
      builder = builder.rest('4');
      for (let i = 0; i < 6; i += 1) builder = builder.rest('8');
      continue;
    }
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

  it('fails the riff gone silent from bar 2', async () => {
    // What a muted strip leaves: the clusters of bars 2 to 4 with nothing to hear.
    const clusters = expectedAttacks(riff(), ...scheduledOf(await render(riff())));
    const attacks = verify(await render(riff('note', 1)), clusters);
    expect(attacks.violation?.code).toBe('attack-missed');
    const silent = attacks.ratios.filter((_, i) => (clusters[i]?.when ?? 0) >= START + 1.2);
    // The first reads as heard: the release of bar 1's last note, the detector's known blind spot.
    expect(silent).toHaveLength(21);
    expect(
      silent.filter((ratio) => ratio < ATTACK_THRESHOLDS.missed).length,
    ).toBeGreaterThanOrEqual(20);
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
