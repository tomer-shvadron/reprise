import { describe, expect, it } from 'vitest';

import { read, readGp3To5 } from '../../src/index';
import { fixtureBytes } from '../corpus';
import { FEATURE_KEYS, listeningFeatures } from './read-facts';

async function featuresOf(fixture: string) {
  const { score } = await read(fixtureBytes(fixture));
  return new Map(listeningFeatures(score).map((feature) => [feature.key, feature]));
}

describe('listeningFeatures', () => {
  it('lists the effects of effects.gp5 with their first bars', async () => {
    const features = await featuresOf('gp5/effects.gp5');
    expect(features.get('bends')).toEqual({
      key: 'bends',
      bars: [7, 8],
      detail: 'bend, bendReleaseBend',
    });
    expect(features.get('harmonics')?.bars).toEqual([4]);
    expect(features.get('whammy')?.detail).toBe('dip, dive, releaseUp');
    expect(features.get('slides')?.bars).toEqual([14, 15]);
    expect(features.get('tempo-change')?.bars).toEqual([22]);
    expect(features.get('palm-mute')?.bars).toEqual([18, 30, 31]);
    expect(features.has('drums')).toBe(false);
  });

  it('lists every GM drum note of drum-tabs.gp by name, at most five bars', async () => {
    const drums = (await featuresOf('gp/drum-tabs.gp')).get('drums');
    expect(drums?.bars).toEqual([1, 2, 3, 4, 5]);
    expect(drums?.detail).toMatch(/^35 Acoustic Bass Drum, 36 Bass Drum 1, /);
  });

  it('emits only the keys it declares', async () => {
    for (const fixture of [
      'gp5/effects.gp5',
      'gp/drum-tabs.gp',
      'gp5/directions.gp5',
      'gpx/chords.gpx',
    ]) {
      for (const key of (await featuresOf(fixture)).keys()) {
        expect(FEATURE_KEYS).toContain(key);
      }
    }
  });
});

describe('the binary version', () => {
  it('is read from the header', () => {
    expect([500, 510]).toContain(readGp3To5(fixtureBytes('gp5/effects.gp5')).version);
    expect(readGp3To5(fixtureBytes('gp3/effects.gp3')).version).toBe(300);
  });
});
