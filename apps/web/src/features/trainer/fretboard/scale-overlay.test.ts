import { score } from '@reprise/model/testing';
import { act } from '@testing-library/react';
import { write } from '@reprise/formats';
import { describe, expect, it } from 'vitest';

import { aMinorRiff } from '@/test/a-minor-riff';
import { createTestServices } from '@/test/services';

import { scaleOverlayFor, songScaleOf } from './scale-overlay';

describe('scaleOverlayFor', () => {
  it('is one store per services, labelled with the spelled name', () => {
    const services = createTestServices();
    const store = scaleOverlayFor(services);
    expect(scaleOverlayFor(services)).toBe(store);
    store.getState().show(9, 'minorPentatonic', 'manual');
    expect(store.getState().overlay).toMatchObject({
      label: 'A minor pentatonic',
      source: 'manual',
    });
    store.getState().clear();
    expect(store.getState().overlay).toBeUndefined();
  });

  it('drops a song overlay when another document opens and keeps a manual one', async () => {
    const services = createTestServices();
    const store = scaleOverlayFor(services);
    const { bytes } = await write(
      score().tempo(120).track('guitar').bar().beat('4', []).build(),
      'reprise',
    );
    store.getState().show(2, 'dorian', 'song');
    await act(async () => {
      await services.document.getState().openBytes('a.reprise', bytes);
    });
    expect(store.getState().overlay).toBeUndefined();
    store.getState().show(2, 'dorian', 'manual');
    await act(async () => {
      await services.document.getState().openBytes('b.reprise', bytes);
    });
    expect(store.getState().overlay?.source).toBe('manual');
  });
});

describe('songScaleOf', () => {
  it('names the scale the key engine finds', () => {
    const found = songScaleOf(aMinorRiff());
    expect(found?.tonic).toBe(9);
    expect(found?.scaleId).toBe('minorPentatonic');
  });

  it('has no answer for a score with too few notes', () => {
    expect(songScaleOf(score().tempo(120).track('guitar').bar().beat('4', []).build())).toBe(
      undefined,
    );
  });
});
