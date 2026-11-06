import { describe, expect, it } from 'vitest';

import { fetchFixture } from '@/test/assets';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

// In a browser only because it reads fixtures; the audio is the fake one.
describe('installTransport over fixtures', () => {
  it('starts the bytes of one song opened under another song’s name at 100%', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    const { document, audio, playback } = services;
    const chords = await fetchFixture('gp5/chords.gp5');
    const effects = await fetchFixture('gp5/effects.gp5');
    const tempo = () => playback.getState().settings.tempo.value;

    await document.getState().openBytes('chords.gp5', chords);
    audio.setTempo('percent', 75);
    await document.getState().openBytes('effects.gp5', effects);
    expect(tempo()).toBe(100);
    await document.getState().openBytes('chords.gp5', chords);
    expect(tempo()).toBe(75);
    await document.getState().openBytes('chords.gp5', effects);
    expect(tempo()).toBe(100);
    await document.getState().openBytes('renamed.gp5', chords);
    expect(tempo()).toBe(75);
  });
});
