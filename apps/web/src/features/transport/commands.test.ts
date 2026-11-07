import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars, positionEventAt } from '@/test/position';
import { createTestServices } from '@/test/services';

async function setup(song?: Score) {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  if (song) {
    await services.document
      .getState()
      .openBytes('song.reprise', (await write(song, 'reprise')).bytes);
    services.playback.setState({ song: { status: 'ready', error: undefined } });
  }
  const run = (id: string) => registry.get(id)?.run();
  return { services, registry, run };
}

describe('transport commands', () => {
  it('register with the app’s commands without a shortcut conflict, each with a shortcut', async () => {
    const { registry } = await setup();
    const transport = registry.list().filter((command) => command.id.startsWith('transport.'));
    expect(transport).toHaveLength(22);
    for (const command of transport) expect(command.shortcut, command.id).toBeDefined();
  });

  it('play, pause, stop and play from the start', async () => {
    const { services, run } = await setup(fourBars());
    const { fakeAudio } = services;
    await run('transport.playPause');
    expect(fakeAudio.togglePlay).toHaveBeenCalledOnce();
    await run('transport.stop');
    expect(fakeAudio.stop).toHaveBeenCalledOnce();
    await run('transport.playFromStart');
    expect(fakeAudio.stop).toHaveBeenCalledTimes(2);
    expect(fakeAudio.stop.mock.invocationCallOrder[1]).toBeLessThan(
      fakeAudio.play.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('do not play from the start before the song is ready', async () => {
    const { services, run } = await setup();
    await run('transport.playFromStart');
    expect(services.fakeAudio.play).not.toHaveBeenCalled();
  });

  it('step and toggle the speed, and no-op with no song', async () => {
    const empty = await setup();
    const calls = empty.services.fakeAudio.setTempo.mock.calls.length;
    await empty.run('transport.speedUp');
    await empty.run('transport.toggleSpeed');
    expect(empty.services.fakeAudio.setTempo).toHaveBeenCalledTimes(calls);

    const { services, run } = await setup(fourBars());
    const percent = () => services.playback.getState().settings.tempo.value;
    await run('transport.speedUp');
    await run('transport.speedUp');
    expect(percent()).toBe(110);
    await run('transport.slowDown');
    expect(percent()).toBe(105);
    await run('transport.toggleSpeed');
    expect(percent()).toBe(100);
    await run('transport.toggleSpeed');
    expect(percent()).toBe(105);
  });

  it('loop the selection, or the whole song with none', async () => {
    const song = fourBars();
    const { services, run } = await setup(song);
    const bars = services.document.getState().score?.masterBars ?? [];
    await run('transport.toggleLoop');
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: bars[0]?.id,
      endBar: bars[3]?.id,
    });
    await run('transport.toggleLoop');
    expect(services.playback.getState().settings.loop).toBeUndefined();

    const range = { startBar: bars[1]?.id ?? '', endBar: bars[2]?.id ?? '' };
    services.selection.getState().selectBars(range);
    await run('transport.toggleLoop');
    expect(services.playback.getState().settings.loop).toEqual(range);
  });

  it('announce an unloopable range and keep the loop off', async () => {
    const { services, run } = await setup(fourBars());
    const bars = services.document.getState().score?.masterBars ?? [];
    services.fakeAudio.setLoop.mockImplementationOnce(() => {
      throw new RangeError('never played in that order');
    });
    services.selection
      .getState()
      .selectBars({ startBar: bars[1]?.id ?? '', endBar: bars[2]?.id ?? '' });
    await run('transport.toggleLoop');
    expect(services.fakeAudio.setLoop).toHaveBeenLastCalledWith(undefined);
    expect(services.playback.getState().settings.loop).toBeUndefined();
    expect(services.transport.getState().announcement?.text).toBe(
      'Bars 2 to 3 can’t be looped: they never play in that order.',
    );
  });

  it('toggle the count-in and metronome, open the volumes and announce the position', async () => {
    const { services, run } = await setup(fourBars());
    await run('transport.toggleCountIn');
    expect(services.fakeAudio.setCountIn).toHaveBeenLastCalledWith(true);
    await run('transport.toggleMetronome');
    expect(services.fakeAudio.setMetronome).toHaveBeenLastCalledWith(true, 0.7);
    await run('transport.metronomeVolume');
    expect(services.transport.getState().popover).toBe('metronome');
    await run('transport.masterVolume');
    expect(services.transport.getState().popover).toBe('master');
    await run('transport.announcePosition');
    expect(services.transport.getState().announcement?.text).toMatch(/^Bar 1 of 4, beat 1 of 4/);
  });

  it('step the playhead by beats and bars, announcing the position while stopped', async () => {
    const { services, run } = await setup(fourBars());
    const { fakeAudio, transport } = services;
    await run('transport.nextBar');
    expect(fakeAudio.seek).toHaveBeenLastCalledWith(3840);
    expect(services.ui.getState().follow.request).toBe(1);
    expect(transport.getState().announcement?.text).toMatch(/^Bar 2 of 4, beat 1 of 4/);
    await run('transport.nextBeat');
    expect(fakeAudio.seek).toHaveBeenLastCalledWith(3840 + 960);
    await run('transport.previousBeat');
    expect(fakeAudio.seek).toHaveBeenLastCalledWith(3840);
    await run('transport.lastBar');
    expect(fakeAudio.seek).toHaveBeenLastCalledWith(3 * 3840);
    await run('transport.firstBar');
    expect(fakeAudio.seek).toHaveBeenLastCalledWith(0);
    const seeks = fakeAudio.seek.mock.calls.length;
    await run('transport.barStart');
    await run('transport.previousBar');
    expect(fakeAudio.seek).toHaveBeenCalledTimes(seeks);

    services.playback.setState({ transport: 'playing' });
    const announced = transport.getState().announcement;
    await run('transport.nextBar');
    expect(transport.getState().announcement).toBe(announced);
  });

  it('step from the drawn playhead while playing, which lags the engine', async () => {
    const { services, run } = await setup(fourBars());
    const score = services.document.getState().score;
    if (!score) throw new Error('no score');
    services.playback.setState({
      transport: 'playing',
      position: positionEventAt(score, 2 * 3840 + 100),
    });
    services.heard.current = {
      masterBarId: score.masterBars[1]?.id ?? '',
      tick: 3800,
      playbackTick: 3840 + 3800,
    };
    await run('transport.nextBar');
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(2 * 3840);
  });

  it('extend from a click’s anchor with nothing selected, as Shift+click does', async () => {
    const { services, run } = await setup(fourBars());
    const bars = services.document.getState().score?.masterBars ?? [];
    services.selection.getState().selectBars(undefined, bars[0]?.id);
    await run('transport.lastBar');
    await run('transport.selectNextBar');
    expect(services.selection.getState().bars).toEqual({
      startBar: bars[0]?.id,
      endBar: bars[1]?.id,
    });
  });

  it('extend the bar selection from its anchor and announce it', async () => {
    const { services, run } = await setup(fourBars());
    const bars = services.document.getState().score?.masterBars ?? [];
    const id = (index: number) => bars[index]?.id ?? '';
    await run('transport.nextBar');
    await run('transport.selectNextBar');
    expect(services.selection.getState()).toMatchObject({
      bars: { startBar: id(1), endBar: id(2) },
      barsAnchor: id(1),
    });
    await run('transport.selectNextBar');
    expect(services.transport.getState().announcement?.text).toBe('Bars 2 to 4 selected');
    await run('transport.selectPreviousBar');
    await run('transport.selectPreviousBar');
    await run('transport.selectPreviousBar');
    expect(services.selection.getState().bars).toEqual({ startBar: id(0), endBar: id(1) });
  });

  it('do nothing without a song, and Follow playback requests following', async () => {
    const { services, run } = await setup();
    for (const id of ['transport.nextBeat', 'transport.lastBar', 'transport.selectNextBar']) {
      await run(id);
    }
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.selection.getState().bars).toBeUndefined();
    services.ui.getState().pauseFollow();
    await run('view.followPlayback');
    expect(services.ui.getState().follow).toEqual({ on: true, request: 1 });
  });
});
