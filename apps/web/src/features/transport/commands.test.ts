import { write } from '@reprise/formats';
import { removeBar, type Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars, positionEventAt } from '@/test/position';

import { sectionRange } from './menu-target';
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
    // The menu's own commands have no key.
    const menuOnly = [
      'transport.playFromSelection',
      'transport.loopSelection',
      'transport.loopSection',
    ];
    expect(transport).toHaveLength(22 + menuOnly.length);
    for (const command of transport) {
      if (!menuOnly.includes(command.id)) expect(command.shortcut, command.id).toBeDefined();
    }
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

  it('loop the clicked bar while the playhead is in it, else the whole song', async () => {
    const { services, run } = await setup(fourBars());
    const score = services.document.getState().score;
    if (!score) throw new Error('no score');
    const id = (index: number) => score.masterBars[index]?.id ?? '';
    const loop = () => services.playback.getState().settings.loop;
    services.selection.getState().selectBars(undefined, id(2));
    services.playback.setState({ position: positionEventAt(score, 2 * 3840 + 100) });
    await run('transport.toggleLoop');
    expect(loop()).toEqual({ startBar: id(2), endBar: id(2) });
    await run('transport.toggleLoop');
    expect(loop()).toBeUndefined();

    // The playhead has moved on (playback, or a keyboard step): the click is stale.
    services.playback.setState({ position: positionEventAt(score, 3 * 3840 + 100) });
    await run('transport.toggleLoop');
    expect(loop()).toEqual({ startBar: id(0), endBar: id(3) });
  });

  it('loop the whole song when the clicked bar was removed', async () => {
    const { services, run } = await setup(fourBars());
    const score = services.document.getState().score;
    if (!score) throw new Error('no score');
    const id = (index: number) => score.masterBars[index]?.id ?? '';
    services.selection.getState().selectBars(undefined, id(2));
    services.playback.setState({ position: positionEventAt(score, 2 * 3840 + 100) });
    services.document.getState().apply(removeBar({ masterBarId: id(2) }));
    await run('transport.toggleLoop');
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: id(0),
      endBar: id(3),
    });
  });

  it('keep a wider loop through a seek-click inside it', async () => {
    const { services, run } = await setup(fourBars());
    const bars = services.document.getState().score?.masterBars ?? [];
    const id = (index: number) => bars[index]?.id ?? '';
    const wide = { startBar: id(0), endBar: id(2) };
    services.selection.getState().selectBars(wide);
    await run('transport.toggleLoop');
    expect(services.playback.getState().settings.loop).toEqual(wide);
    services.selection.getState().selectBars(undefined, id(1));
    expect(services.playback.getState().settings.loop).toEqual(wide);
  });

  it('prefer a drag selection over the clicked bar', async () => {
    const { services, run } = await setup(fourBars());
    const bars = services.document.getState().score?.masterBars ?? [];
    const range = { startBar: bars[1]?.id ?? '', endBar: bars[2]?.id ?? '' };
    services.selection.getState().selectBars(undefined, bars[3]?.id);
    services.selection.getState().selectBars(range, bars[1]?.id);
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
    expect(services.ui.getState().follow).toMatchObject({ on: true, request: 1 });
  });

  describe('on the menu target', () => {
    async function targeted() {
      const set = await setup(fourBars());
      const score = set.services.document.getState().score;
      if (!score) throw new Error('no score');
      const bar = (index: number) => score.masterBars[index]?.id ?? '';
      const beat = score.tracks[0]?.bars[2]?.voices[0]?.beats[1]?.id ?? '';
      return { ...set, score, bar, beat };
    }

    it('play from the right-clicked beat or bar, which turns an outside loop off', async () => {
      const { services, run, bar, beat } = await targeted();
      const { fakeAudio, menuTarget } = services;
      menuTarget.getState().set({ kind: 'beat', beat, track: 'x', masterBar: bar(2) });
      await run('transport.playFromSelection');
      expect(fakeAudio.seek).toHaveBeenLastCalledWith(2 * 3840 + 960);
      expect(fakeAudio.play).toHaveBeenCalledOnce();

      services.audio.setLoop({ startBar: bar(0), endBar: bar(0) });
      menuTarget.getState().set({ kind: 'bar', masterBar: bar(3), track: undefined });
      await run('transport.playFromSelection');
      expect(fakeAudio.seek).toHaveBeenLastCalledWith(3 * 3840);
      expect(services.playback.getState().settings.loop).toBeUndefined();
    });

    it('play from the first selected bar without a menu, and say so with nothing', async () => {
      const { services, run, bar } = await targeted();
      await run('transport.playFromSelection');
      expect(services.fakeAudio.play).not.toHaveBeenCalled();
      services.selection.getState().selectBars({ startBar: bar(1), endBar: bar(2) });
      await run('transport.playFromSelection');
      expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(3840);
    });

    it('loop the right-clicked bar, replacing a loop, and leave the selection and playhead', async () => {
      const { services, run, bar } = await targeted();
      const loop = () => services.playback.getState().settings.loop;
      services.audio.setLoop({ startBar: bar(0), endBar: bar(3) });
      services.selection.getState().selectBars({ startBar: bar(0), endBar: bar(0) });
      services.menuTarget.getState().set({ kind: 'bar', masterBar: bar(2), track: undefined });
      await run('transport.loopSelection');
      expect(loop()).toEqual({ startBar: bar(2), endBar: bar(2) });
      expect(services.selection.getState().bars).toEqual({ startBar: bar(0), endBar: bar(0) });
      expect(services.fakeAudio.seek).not.toHaveBeenCalled();

      // The range target loops the selected bars, and a second run keeps the loop on.
      services.selection.getState().selectBars({ startBar: bar(1), endBar: bar(2) });
      services.menuTarget.getState().set({ kind: 'range' });
      await run('transport.loopSelection');
      await run('transport.loopSelection');
      expect(loop()).toEqual({ startBar: bar(1), endBar: bar(2) });
    });

    it('is enabled only with a bar to loop, and loopSection only on a section', async () => {
      const { registry, services, bar } = await targeted();
      expect(registry.get('transport.loopSelection')?.enabled?.()).toBe(false);
      services.selection.getState().selectBars({ startBar: bar(1), endBar: bar(1) });
      expect(registry.get('transport.loopSelection')?.enabled?.()).toBe(true);
      expect(registry.get('transport.loopSection')?.enabled?.()).toBe(false);
    });

    it('loop a section from its marker to the bar before the next', async () => {
      const builder = score().track('guitar');
      for (let i = 0; i < 6; i += 1) {
        builder.bar();
        if (i === 1) builder.section('Verse');
        if (i === 4) builder.section('Chorus');
        builder.beat('4', [note(1, 0)]);
      }
      const { services, run } = await setup(builder.build());
      const bars = services.document.getState().score?.masterBars ?? [];
      services.menuTarget.getState().set({ kind: 'section', masterBar: bars[1]?.id ?? '' });
      await run('transport.loopSection');
      expect(services.playback.getState().settings.loop).toEqual({
        startBar: bars[1]?.id,
        endBar: bars[3]?.id,
      });
      expect(
        sectionRange(services.document.getState().score as Score, bars[0]?.id ?? ''),
      ).toBeUndefined();
    });
  });
});
