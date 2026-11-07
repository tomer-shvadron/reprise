import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { rms } from '@/test/offline';
import { player } from '@/test/player-harness';

/** At 120 BPM a bar is 2 s: Lead plays bar 1 only, Rhythm bars 2 and 3 only. */
function leadThenRhythm(): Score {
  const quarters = (builder: ReturnType<typeof score>) =>
    builder
      .beat('4', [note(1, 3)])
      .beat('4', [note(1, 3)])
      .beat('4', [note(1, 3)])
      .beat('4', [note(1, 3)]);
  let builder = score().tempo(120).track('guitar', { name: 'Lead' }).bar();
  builder = quarters(builder).bar().rest('1').bar().rest('1');
  builder = builder.track('guitar', { name: 'Rhythm' }).bar().rest('1').bar();
  builder = quarters(builder).bar();
  return quarters(builder).build();
}

// The synthetic bank is quiet: a bar of its quarters measures about 6e-4.
const AUDIBLE = 1e-4;

const soloLead = () =>
  within(screen.getByRole('complementary', { name: 'Tracks' })).getByRole('button', {
    name: 'Solo Lead',
  });

async function setup() {
  const p = player();
  await p.openScore(leadThenRhythm());
  const offline = p.prepare(6.3);
  p.services.audio.unlock();
  const { engine } = p.services.audio.debug();
  const load = vi.spyOn(engine, 'load');
  return { p, offline, load };
}

describe('the mixer, heard', () => {
  it('plays every track with no solo', async () => {
    const { p, offline } = await setup();
    p.services.audio.play();
    const buffer = await p.renderAudio(offline);
    expect(rms(buffer, 2.4, 3.9)).toBeGreaterThan(AUDIBLE);
    p.services.dispose();
  });

  it('silences the other tracks when one is soloed before Play', async () => {
    const { p, offline, load } = await setup();
    soloLead().click();
    const lead = p.services.document.getState().score?.tracks[0]?.id ?? '';
    expect(p.services.playback.getState().mixer).toEqual({ [lead]: { solo: true } });
    await waitFor(() => {
      expect(soloLead()).toHaveAttribute('aria-pressed', 'true');
    });
    expect(load).not.toHaveBeenCalled();

    p.services.audio.play();
    const buffer = await p.renderAudio(offline);

    expect(rms(buffer, 0.15, 1.9)).toBeGreaterThan(AUDIBLE);
    expect(rms(buffer, 2.4, 6)).toBeLessThan(1e-5);
    p.services.dispose();
  });

  it('silences the other tracks at once when one is soloed during playback', async () => {
    const { p, offline, load } = await setup();
    p.services.audio.play();
    let transport = '';
    const buffer = await p.renderAudio(offline, [
      {
        at: 2.6,
        run: () => {
          soloLead().click();
          transport = p.services.playback.getState().transport;
        },
      },
    ]);

    expect(rms(buffer, 2.15, 2.55)).toBeGreaterThan(AUDIBLE);
    expect(rms(buffer, 2.75, 6)).toBeLessThan(1e-5);
    expect(transport).toBe('playing');
    expect(load).not.toHaveBeenCalled();
    p.services.dispose();
  });
});
