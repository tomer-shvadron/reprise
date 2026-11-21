import { score } from '@reprise/model/testing';
import { act } from '@testing-library/react';
import { write } from '@reprise/formats';
import { describe, expect, it, vi } from 'vitest';

import { aMinorRiff } from '@/test/a-minor-riff';
import { createTestServices } from '@/test/services';

import { analyseScore } from '@/lib/insights';

import { insightsFor } from '../insights/insights-for';

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

describe('a song overlay', () => {
  it('retains the insights while it shows and follows the score through an edit', async () => {
    const services = createTestServices();
    const store = scaleOverlayFor(services);
    const { bytes } = await write(aMinorRiff(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('riff.reprise', bytes);
    });
    const insights = insightsFor(services);
    await insights.getState().ensure();
    store.getState().show(2, 'dorian', 'song');
    await vi.waitFor(() => {
      expect(store.getState().overlay).toMatchObject({ tonic: 9, scaleId: 'minorPentatonic' });
    });
    // An edit that leaves the song with no scale (select all, delete) keeps the overlay on with
    // nothing to draw, and undoing it brings the scale back from the cache.
    const original = services.document.getState().score;
    const bare = score().tempo(120).track('guitar').bar().beat('4', []).build();
    act(() => {
      services.document.setState({ score: bare });
    });
    await vi.waitFor(() => {
      expect(store.getState().overlay).toMatchObject({ source: 'song', none: true });
    });
    act(() => {
      services.document.setState({ score: original });
    });
    await vi.waitFor(() => {
      expect(store.getState().overlay).toMatchObject({ tonic: 9, scaleId: 'minorPentatonic' });
    });
    expect(store.getState().overlay?.none).toBeUndefined();
  });

  it('is not retained by a manual overlay', () => {
    const services = createTestServices();
    const store = scaleOverlayFor(services);
    store.getState().show(9, 'minorPentatonic', 'manual');
    expect(insightsFor(services).getState().status).toBe('idle');
  });
});

describe('songScaleOf', () => {
  it('names the scale the key engine finds', () => {
    const found = songScaleOf(analyseScore(aMinorRiff()));
    expect(found?.tonic).toBe(9);
    expect(found?.scaleId).toBe('minorPentatonic');
  });

  it('has no answer for a score with too few notes', () => {
    expect(
      songScaleOf(analyseScore(score().tempo(120).track('guitar').bar().beat('4', []).build())),
    ).toBe(undefined);
  });
});
