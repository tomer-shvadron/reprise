import { encodeWav } from '@reprise/audio/testing';
import { applyCommand, setTrackProperties } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { player } from '@/test/player-harness';

import { packContents, syntheticManifest, zipFileOf, zipOf } from './test/pack-fixtures';

const MIB = 1024 * 1024;

/** The keys of a bass's string 1 (G2), frets 0 to 7: one file each in the pack. */
const KEYS = [43, 44, 45, 46, 47, 48, 49, 50];

/**
 * Eight mono files of 50 s at 44.1 kHz, 8.4 MiB each once decoded, so the song's plan holds about
 * 67 MiB of pack samples: over the smallest preset and under the default.
 */
function bigPack() {
  // A short tone then silence: the zip stays small while the decoded buffer is full length.
  const tone = new Float32Array(44_100 * 50);
  for (let i = 0; i < 4410; i++) tone[i] = 0.2 * Math.sin(i * 0.0627);
  const wav = encodeWav([tone], 44_100);
  const changes: Record<string, Uint8Array | string> = {
    'default.sfz': KEYS.map(
      (key) =>
        `<region> sample=s/${String(key)}.wav lokey=${String(key)} hikey=${String(key)} pitch_keycenter=${String(key)}`,
    ).join('\n'),
  };
  for (const key of KEYS) changes[`s/${String(key)}.wav`] = wav;
  return packContents(changes);
}

const song = () => {
  let builder = score().tempo(120).track('bass', { name: 'Bass', program: 33 }).bar();
  for (const [index] of KEYS.entries()) builder = builder.beat('8', [note(1, index)]);
  const built = builder.build();
  const trackId = built.tracks[0]?.id ?? '';
  return applyCommand(built, setTrackProperties({ trackId }, { sound: { preset: 'off' } })).score;
};

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe('the memory panel, over the real audio service', () => {
  it('evicts and says so at 64 MB, and recovers at 300 MB', async () => {
    const p = player();
    await p.openScore(song());
    p.services.ui.getState().toggleMixer();
    await p.services.sounds.installZip(
      zipFileOf('Big.zip', await zipOf(bigPack())),
      syntheticManifest(),
    );
    fireEvent.change(await screen.findByRole('combobox', { name: 'Sound of Bass' }), {
      target: { value: 'SynthPack001/default' },
    });
    await p.services.audio.settled();
    p.services.ui.getState().setScreen('sounds');
    const panel = await screen.findByRole('region', { name: 'Memory' });
    const engine = () => p.services.audio.debug().engine;

    // The memory event is coalesced to one per animation frame.
    await frame();
    const first = engine().memory().decodedBytes;
    expect(first).toBeGreaterThan(64 * MIB);
    const meter = within(panel).getByRole('meter');
    await waitFor(() => {
      expect(Number(meter.getAttribute('aria-valuenow'))).toBeGreaterThan(64);
    });
    expect(
      within(panel)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toContain('Synthetic Pack: Default');
    expect(within(panel).queryByText(/needs more than the budget/)).toBeNull();
    const unload = within(panel).getByRole('button', { name: 'Nothing unused' });
    expect(unload).toHaveAttribute('aria-disabled', 'true');
    const reading = within(panel).getByText(/ MB of 300 MB$/).textContent;

    const select = within(panel).getByRole('combobox', { name: 'Memory for sounds' });
    fireEvent.change(select, { target: { value: '64' } });
    await frame();
    expect(engine().memory().decodedBytes).toBeLessThanOrEqual(64 * MIB);
    expect(engine().memory().shortfall).toBe(true);
    await waitFor(() => {
      expect(within(panel).getByText(/needs more than the budget/)).toBeInTheDocument();
    });
    // The panel's own figure, not the meter's value, which is clamped to the budget.
    const decodedMb = (text: string | null) => Number(/^([\d.]+) MB of/.exec(text ?? '')?.[1]);
    await waitFor(() => {
      expect(decodedMb(within(panel).getByText(/ MB of 64 MB$/).textContent)).toBeLessThanOrEqual(
        64,
      );
    });
    expect(meter.getAttribute('aria-valuetext')).toMatch(/ MB of 64 MB$/);
    expect(within(panel).getByRole('button', { name: 'Nothing unused' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    fireEvent.change(select, { target: { value: '300' } });
    await p.services.audio.settled();
    await frame();
    expect(engine().memory().decodedBytes).toBe(first);
    await waitFor(() => {
      expect(within(panel).queryByText(/needs more than the budget/)).toBeNull();
    });
    expect(within(panel).getByText(/ MB of 300 MB$/).textContent).toBe(reading);
    expect(within(panel).getByRole('button', { name: 'Nothing unused' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );

    p.services.dispose();
    cleanup();
  });
});
