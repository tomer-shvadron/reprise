import { note, score } from '@reprise/model/testing';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { player } from '@/test/player-harness';

const SAMPLE_RATE = 44_100;
const FROM = 0.15;
const TO = 0.4;

/**
 * Brightness: the RMS of the sample-to-sample difference over the RMS of the signal. A drive stage
 * adds harmonics, which a difference weighs by their frequency, so it rises with them. The bank
 * is synthetic and its note has no clean partials to measure, hence a broadband measure.
 */
function brightness(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const start = Math.floor(FROM * SAMPLE_RATE);
  const end = Math.floor(TO * SAMPLE_RATE);
  let signal = 0;
  let difference = 0;
  for (let i = start + 1; i < end; i++) {
    const value = data[i] ?? 0;
    signal += value * value;
    difference += (value - (data[i - 1] ?? 0)) ** 2;
  }
  return Math.sqrt(difference / signal);
}

/** A guitar track on the default program (no pack: the GM tier) holding one whole note. */
const song = () =>
  score()
    .tempo(120)
    .track('guitar', { name: 'Lead' })
    .bar()
    .beat('1', [note(1, 3)])
    .build();

async function render(pick?: string): Promise<number> {
  const p = player();
  await p.openScore(song());
  p.services.ui.getState().showPanelView('mixer');
  if (pick) {
    const select = await screen.findByRole('combobox', { name: 'Effects of Lead' });
    fireEvent.change(select, { target: { value: pick } });
    expect(p.services.document.getState().score?.tracks[0]?.sound).toEqual({ preset: pick });
  }
  const offline = p.prepare(2);
  p.services.audio.unlock();
  p.services.audio.play();
  const buffer = await p.renderAudio(offline);
  p.services.dispose();
  cleanup();
  return brightness(buffer);
}

describe('the effects preset, heard', () => {
  it('leaves a GM track bare by default and brightens it once a distortion preset is picked', async () => {
    const bare = await render();
    const picked = await render('distortion');
    // Measured 0.084 bare and 0.182 picked. Bare is bounded to show the GM default stays dry;
    // picked is bounded by its ratio to bare, and applies because it was picked on the track, so
    // the GM tier bypass (on by default) does not skip it.
    expect(bare).toBeLessThan(0.12);
    expect(picked).toBeGreaterThan(bare * 1.5);
  });
});
