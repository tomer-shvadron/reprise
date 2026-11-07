import { describe, expect, it } from 'vitest';

import * as root from './index';
import { createAudioEngine } from './index';
import * as testing from './testing/index';

describe('@reprise/audio', () => {
  it('exposes its root export', () => {
    expect(typeof createAudioEngine).toBe('function');
  });

  it('keeps the engine diagnostics in the test-only entry, off the root export', () => {
    expect('debugAudioEngine' in root).toBe(false);
    expect(typeof testing.debugAudioEngine).toBe('function');
  });

  it('renders silence through an OfflineAudioContext', async () => {
    const sampleRate = 44_100;
    const context = new OfflineAudioContext({
      numberOfChannels: 2,
      length: sampleRate / 10,
      sampleRate,
    });
    const buffer = await context.startRendering();

    expect(buffer.length).toBe(sampleRate / 10);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.getChannelData(0).every((sample) => sample === 0)).toBe(true);
  });
});
