import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { createTestServices } from '@/test/services';

import { createSpeedTrainer, referenceBpmFor } from './speed-trainer-store';
import { speedTrainerFor } from './speed-trainer-for';

async function setup(song: Score = fourBars()) {
  const services = createTestServices();
  mirrorAudio(services);
  const { bytes } = await write(song, 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const opened = services.document.getState().score;
  if (!opened) throw new Error('no score');
  const [first, , third] = opened.masterBars;
  if (!first || !third) throw new Error('bars');
  services.fakeAudio.setLoop({ startBar: first.id, endBar: first.id });
  services.fakeAudio.setLoop.mockClear();
  const trainer = createSpeedTrainer(services);
  let pass = 0;
  const loop = () => {
    pass += 1;
    services.playback.setState({ lastLoop: { pass, when: pass } });
  };
  const tempo = () => services.playback.getState().settings.tempo;
  return { services, trainer, loop, tempo, opened, first, third };
}

const ramp = { unit: 'percent', start: 100, step: 10, target: 120, repsPerStep: 2 } as const;

describe('the speed trainer store', () => {
  it('starts from the top at the start tempo and notes the loop', async () => {
    const { services, trainer } = await setup();
    trainer.getState().setConfig(ramp);
    services.practice
      .getState()
      .start({ songId: undefined, documentId: services.document.getState().id ?? '', now: 0 });

    trainer.getState().start();

    const { fakeAudio } = services;
    expect(trainer.getState().status).toBe('running');
    expect(fakeAudio.setTempo).toHaveBeenCalledWith('percent', 100);
    const order = [
      fakeAudio.stop.mock.invocationCallOrder[0],
      fakeAudio.setTempo.mock.invocationCallOrder.at(-1),
      fakeAudio.play.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(services.practice.getState().session?.loops).toHaveLength(1);
    expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
  });

  it('does not hold on the notifications of its own Start', async () => {
    const { services, trainer } = await setup();
    // The real service notifies on stop and play; the tempo it still shows is the user's old one.
    services.fakeAudio.setTempo('percent', 90);
    services.fakeAudio.stop.mockImplementation(() => {
      services.playback.setState({ transport: 'stopped' });
    });
    trainer.getState().start();
    expect(trainer.getState().status).toBe('running');
  });

  it('needs a score and a loop', async () => {
    const { services, trainer } = await setup();
    services.fakeAudio.setLoop(undefined);
    trainer.getState().start();
    expect(trainer.getState().status).toBe('idle');
    expect(services.fakeAudio.play).not.toHaveBeenCalled();
    expect(services.transport.getState().announcement?.text).toBe('Loop some bars first');
  });

  it('applies the next step synchronously inside the loop notification', async () => {
    const { services, trainer, loop, tempo } = await setup();
    trainer.getState().setConfig(ramp);
    trainer.getState().start();
    let seen: unknown;
    // The nested notification reaches this after the trainer's: it must already have stepped.
    services.playback.subscribe((state, previous) => {
      if (state.lastLoop !== previous.lastLoop) seen = tempo();
    });
    loop();
    expect(tempo()).toEqual({ mode: 'percent', value: 100 });
    loop();
    // No await between the event and the assertion: the engine has scheduled the next pass by then.
    expect(tempo()).toEqual({ mode: 'percent', value: 110 });
    expect(seen).toEqual({ mode: 'percent', value: 110 });
    expect(trainer.getState()).toMatchObject({ stepIndex: 1, reps: 0 });
  });

  it('does not hold on a step when an earlier listener changes the store on a loop event', async () => {
    const { services, trainer, loop, tempo } = await setup();
    // Subscribed before Start, so it runs first and nests a change inside the loop notification.
    services.playback.subscribe((state, previous) => {
      if (state.lastLoop !== previous.lastLoop) {
        services.playback.setState({ output: { status: 'ready', error: undefined } });
      }
    });
    trainer.getState().setConfig({ ...ramp, repsPerStep: 1 });
    trainer.getState().start();
    loop();
    loop();
    loop();
    expect(trainer.getState().status).toBe('done');
    expect(tempo().value).toBe(120);
  });

  it('shows no stale run after a finished run’s loop changes', async () => {
    const { services, trainer, loop, third } = await setup();
    trainer.getState().setConfig({ ...ramp, start: 110, repsPerStep: 1 });
    trainer.getState().start();
    loop();
    loop();
    expect(trainer.getState().status).toBe('done');
    services.fakeAudio.setLoop({ startBar: third.id, endBar: third.id });
    expect(trainer.getState().status).toBe('idle');
  });

  it('resets without a false hold when another document opens', async () => {
    const { services, trainer } = await setup();
    trainer.getState().start();
    services.transport.getState().announce('');
    const { bytes } = await write(fourBars(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('other.reprise', bytes);
    });
    expect(trainer.getState().status).toBe('idle');
    expect(services.transport.getState().announcement?.text).toBe('Speed trainer reset');
  });

  it('records each completed step in a started session, and only then', async () => {
    const { services, trainer, loop } = await setup();
    trainer.getState().setConfig({ ...ramp, repsPerStep: 1 });
    trainer.getState().start();
    loop();
    expect(services.practice.getState().session).toBeUndefined();

    trainer.getState().reset();
    services.practice
      .getState()
      .start({ songId: undefined, documentId: services.document.getState().id ?? '', now: 0 });
    trainer.getState().start();
    loop();
    loop();
    expect(services.practice.getState().session?.loops[0]?.bestPercent).toBe(110);
  });

  it('ignores events while held, and sets the step tempo again on resume', async () => {
    const { services, trainer, loop, tempo } = await setup();
    trainer.getState().setConfig({ ...ramp, repsPerStep: 1 });
    trainer.getState().start();
    trainer.getState().hold();
    loop();
    expect(trainer.getState().stepIndex).toBe(0);
    services.fakeAudio.setTempo('percent', 60);
    expect(trainer.getState().status).toBe('held');
    trainer.getState().resume();
    expect(trainer.getState().status).toBe('running');
    expect(tempo()).toEqual({ mode: 'percent', value: 100 });
    loop();
    expect(tempo()).toEqual({ mode: 'percent', value: 110 });
  });

  it('repeats or steps back after a missed pass, by policy', async () => {
    const repeat = await setup();
    repeat.trainer.getState().setConfig({ ...ramp, repsPerStep: 1 });
    repeat.trainer.getState().start();
    repeat.loop();
    repeat.trainer.getState().markMissed();
    repeat.loop();
    expect(repeat.tempo().value).toBe(110);
    expect(repeat.trainer.getState().reps).toBe(0);

    const down = await setup();
    down.trainer.getState().setConfig({ ...ramp, repsPerStep: 1, onMiss: 'stepDown' });
    down.trainer.getState().start();
    down.loop();
    down.trainer.getState().markMissed();
    down.loop();
    expect(down.tempo().value).toBe(100);
    expect(down.trainer.getState().stepIndex).toBe(0);
  });

  it('holds when the user changes the tempo, not for its own steps', async () => {
    const { services, trainer, loop } = await setup();
    trainer.getState().setConfig({ ...ramp, repsPerStep: 1 });
    trainer.getState().start();
    loop();
    expect(trainer.getState().status).toBe('running');
    services.fakeAudio.setTempo('percent', 90);
    expect(trainer.getState().status).toBe('held');
  });

  it('resets when the loop changes or is cleared, and when another document opens', async () => {
    const cleared = await setup();
    cleared.trainer.getState().start();
    cleared.services.fakeAudio.setLoop(undefined);
    expect(cleared.trainer.getState().status).toBe('idle');

    const moved = await setup();
    moved.trainer.getState().start();
    moved.services.fakeAudio.setLoop({ startBar: moved.third.id, endBar: moved.third.id });
    expect(moved.trainer.getState().status).toBe('idle');

    const other = await setup();
    other.trainer.getState().start();
    const { bytes } = await write(fourBars(), 'reprise');
    await act(async () => {
      await other.services.document.getState().openBytes('other.reprise', bytes);
    });
    expect(other.trainer.getState().status).toBe('idle');
  });

  it('is done at the target and then leaves the tempo alone', async () => {
    const { services, trainer, loop, tempo } = await setup();
    trainer.getState().setConfig({ ...ramp, start: 110, repsPerStep: 1 });
    trainer.getState().start();
    loop();
    loop();
    expect(trainer.getState().status).toBe('done');
    expect(tempo().value).toBe(120);
    services.fakeAudio.setTempo.mockClear();
    loop();
    loop();
    expect(services.fakeAudio.setTempo).not.toHaveBeenCalled();
  });

  it('sets the start tempo again on reset', async () => {
    const { trainer, loop, tempo } = await setup();
    trainer.getState().setConfig({ ...ramp, repsPerStep: 1 });
    trainer.getState().start();
    loop();
    expect(tempo().value).toBe(110);
    trainer.getState().reset();
    expect(trainer.getState().status).toBe('idle');
    expect(tempo().value).toBe(100);
  });

  it('counts a loop event seen twice once', async () => {
    const { services, trainer } = await setup();
    trainer.getState().setConfig({ ...ramp, repsPerStep: 3 });
    trainer.getState().start();
    const event = { pass: 1, when: 1 };
    services.playback.setState({ lastLoop: event });
    services.playback.setState({ lastLoop: event, output: { status: 'ready', error: undefined } });
    expect(trainer.getState().reps).toBe(1);
  });

  it('reads a BPM ramp against the tempo at the loop start and records the percent', async () => {
    const { services, trainer, third, loop, tempo } = await setup();
    services.fakeAudio.setLoop({ startBar: third.id, endBar: third.id });
    expect(referenceBpmFor(services, { startBar: third.id, endBar: third.id })).toBe(160);
    trainer.getState().setConfig({ unit: 'bpm', start: 80, step: 40, target: 160, repsPerStep: 1 });
    trainer.getState().start();
    expect(tempo().value).toBe(50);
    loop();
    expect(tempo().value).toBe(75);
  });

  it('is one instance per services, so a run outlives the panel', async () => {
    const { services } = await setup();
    expect(speedTrainerFor(services)).toBe(speedTrainerFor(services));
  });
});
