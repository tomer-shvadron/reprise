import { describe, expect, it } from 'vitest';

import { drive, manualTicker } from './offline-driver';
import { VoiceSet } from './voices';

const SAMPLE_RATE = 44_100;

async function settled(set: VoiceSet): Promise<number> {
  for (let attempt = 0; attempt < 50 && set.size > 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return set.size;
}

describe('VoiceSet', () => {
  it(
    'cut silences voices that have not started yet and stops every source',
    { timeout: 30_000 },
    async () => {
      const context = new OfflineAudioContext({
        numberOfChannels: 1,
        length: 3 * SAMPLE_RATE,
        sampleRate: SAMPLE_RATE,
      });
      const set = new VoiceSet();
      for (let index = 0; index < 10; index++) {
        const start = 1 + index * 0.1;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2, start + 0.01);
        oscillator.connect(gain).connect(context.destination);
        set.add(oscillator, gain);
        oscillator.start(start);
        oscillator.stop(start + 5);
      }
      expect(set.size).toBe(10);

      const buffer = await drive(context, {
        tickers: [manualTicker()],
        actions: [
          {
            at: 0.5,
            run: () => {
              set.cut(context.currentTime);
            },
          },
        ],
      });

      expect(buffer.getChannelData(0).every((sample) => Math.abs(sample) < 1e-6)).toBe(true);
      expect(await settled(set)).toBe(0);
    },
  );
});
