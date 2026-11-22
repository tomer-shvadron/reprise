import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { insightsFor } from '../insights/insights-for';

import { arpeggioOverlayFor } from './arpeggio-overlay';

function setup() {
  const services = createTestServices();
  // A client that never answers: the tests only count who retains the store.
  insightsFor(services, {
    client: { analyse: () => new Promise(() => undefined), dispose: () => undefined },
  });
  return { services, store: arpeggioOverlayFor(services), insights: insightsFor(services) };
}

describe('the arpeggio overlay store', () => {
  it('starts off, following, with degree labels', () => {
    const { store } = setup();
    expect(store.getState()).toMatchObject({
      on: false,
      follow: true,
      labels: 'degree',
      held: undefined,
    });
  });

  it('turns on and off', () => {
    const { store } = setup();
    store.getState().turnOn();
    expect(store.getState().on).toBe(true);
    store.getState().turnOff();
    expect(store.getState().on).toBe(false);
  });

  it('holds the chord shown when follow turns off', () => {
    const { store } = setup();
    store.getState().turnOn();
    store.getState().setShown({ kind: 'chord', name: 'Am7', source: 'written' });
    store.getState().setFollow(false);
    expect(store.getState().held).toBe('Am7');
    expect(store.getState().shown).toEqual({ kind: 'chord', name: 'Am7', source: 'held' });
    store.getState().setFollow(true);
    expect(store.getState().held).toBeUndefined();
    expect(store.getState().shown).toEqual({ kind: 'finding' });
  });

  it('asks for a pick when follow turns off with no chord shown', () => {
    const { store } = setup();
    store.getState().turnOn();
    store.getState().setFollow(false);
    expect(store.getState().shown).toEqual({ kind: 'pick' });
  });

  it('holds a picked chord, turning follow off and the overlay on', () => {
    const { store } = setup();
    store.getState().hold('F♯m7b5');
    expect(store.getState()).toMatchObject({ on: true, follow: false, held: 'F♯m7b5' });
  });

  it('keeps a held chord when another document opens', () => {
    const { services, store } = setup();
    store.getState().hold('G7');
    services.document.setState({ id: 'another' });
    expect(store.getState()).toMatchObject({ on: true, held: 'G7' });
  });

  it('retains the insights only while on and following', () => {
    const { store, insights } = setup();
    let held = 0;
    insights.setState({
      retain: () => {
        held++;
      },
      release: () => {
        held--;
      },
    });
    store.getState().turnOn();
    expect(held).toBe(1);
    store.getState().setFollow(false);
    expect(held).toBe(0);
    store.getState().setFollow(true);
    expect(held).toBe(1);
    store.getState().turnOff();
    expect(held).toBe(0);
    // A held chord needs no analysis, even when it turns the overlay on.
    store.getState().hold('Am');
    expect(held).toBe(0);
  });

  it('writes the shown chord only when it changes', () => {
    const { store } = setup();
    let writes = 0;
    store.subscribe(() => {
      writes++;
    });
    store.getState().setShown({ kind: 'chord', name: 'C', source: 'written' });
    store.getState().setShown({ kind: 'chord', name: 'C', source: 'written' });
    store.getState().setShown({ kind: 'none-here' });
    store.getState().setShown({ kind: 'none-here' });
    expect(writes).toBe(2);
  });
});
