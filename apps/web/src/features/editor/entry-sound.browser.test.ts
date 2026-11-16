import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAudioService } from '@/app/audio/audio-service';
import { createPlaybackStore } from '@/state/playback';
import { fetchSyntheticSf2 } from '@/test/assets';
import { drive, manualTicker, rms } from '@/test/offline';
import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';
import { entryController, installEntry } from './entry-controller';
import { createEntryStore } from './entry-store';

const SAMPLE_RATE = 44_100;
const synthetic = fetchSyntheticSf2();

// The whole path a keystroke takes to the speakers: the controller's edit, its preview options
// read from the score, the real audio service and engine, rendered offline.
describe('a digit entered in edit mode', () => {
  it('is heard for the length of its beat, past the default, and not before the key', async () => {
    const services = createTestServices();
    const entry = createEntryStore();
    const playback = createPlaybackStore();
    const scheduler = manualTicker();
    const frames = manualTicker();
    const context = new OfflineAudioContext({
      numberOfChannels: 2,
      length: 3 * SAMPLE_RATE,
      sampleRate: SAMPLE_RATE,
    });
    const audio = createAudioService({
      playback,
      loadSoundfont: () => synthetic,
      createContext: () => context,
      scheduler: scheduler.ticker,
      frames: frames.ticker,
      defer: (run) => {
        run();
      },
    });
    const dispose = installEntry({
      ...services,
      entry,
      preview: (trackId, note, options) => {
        audio.previewNote(trackId, note, options);
      },
    });
    const empty = score().tempo(120).track('guitar', { program: 25 }).bar().build();
    await services.document
      .getState()
      .openBytes('entry.reprise', (await write(empty, 'reprise')).bytes);
    const opened = services.document.getState();
    if (!opened.score || !opened.id) throw new Error('not open');
    audio.setDocument({ id: opened.id, score: opened.score });
    await audio.settled();
    audio.unlock();

    const cursor = cursorAtPosition(
      opened.score,
      { track: 0, bar: 0, voice: 0, stop: 0 },
      { string: 1, staff: 'tab' },
    );
    if (!cursor) throw new Error('no cursor');
    services.selection.getState().setEdit({ cursor, currentTrack: cursor.track });
    services.editing.getState().setEditing(true);

    const buffer = await drive(context, {
      tickers: [scheduler, frames],
      actions: [
        {
          at: 0.5,
          run: () => {
            // A half note: one second at 120 bpm, longer than the sampler's 0.6 s default.
            entryController(entry)?.act({ kind: 'longer' });
            entryController(entry)?.fret(5);
          },
        },
      ],
    });

    expect(services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats).toHaveLength(
      1,
    );
    expect(rms(buffer, 0, 0.45)).toBe(0);
    expect(rms(buffer, 0.6, 0.9)).toBeGreaterThan(1e-4);
    // Still sounding well past the default's 0.6 s, so the beat's length was mapped...
    expect(rms(buffer, 1.25, 1.4)).toBeGreaterThan(2e-5);
    // ...and over once that second and the release are.
    expect(rms(buffer, 2.4, 3)).toBeLessThan(1e-5);
    dispose();
    audio.dispose();
  });
});
