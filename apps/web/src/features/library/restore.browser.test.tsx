import { write } from '@reprise/formats';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { restoreTrackSession } from '@/features/tracks';
import { rms } from '@/test/offline';
import { player } from '@/test/player-harness';

// At 120 BPM a bar is 2 s: Lead plays bar 1 only, Rhythm bars 2 and 3 only.
function leadThenRhythm() {
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

const AUDIBLE = 1e-4;

describe('restoring a song session into the real audio service', () => {
  it('honours a mute restored right after the open, while the song is still loading', async () => {
    const p = player();
    const bytes = (await write(leadThenRhythm(), 'reprise')).bytes;
    // No wait for the paint or for the audio to settle: the restore is what the library does.
    await p.services.document.getState().openBytes('song.reprise', bytes);
    const lead = p.services.document.getState().score?.tracks[0]?.id ?? '';
    restoreTrackSession(p.services, {
      version: 1,
      view: { tracks: 'all' },
      mixer: { [lead]: { mute: true } },
    });
    const offline = p.prepare(6.3);
    p.services.audio.unlock();
    await p.services.audio.settled();
    p.services.audio.play();
    const buffer = await p.renderAudio(offline);

    expect(p.services.playback.getState().mixer[lead]).toMatchObject({ mute: true });
    expect(rms(buffer, 0.15, 1.9)).toBeLessThan(1e-5);
    expect(rms(buffer, 2.4, 6)).toBeGreaterThan(AUDIBLE);
    expect(p.services.document.getState().dirty).toBe(false);
    p.services.dispose();
  });
});
