import { write } from '@reprise/formats';
import { setBeatEffect } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { insightsFor } from './insights/insights-for';
import { createAppRegistry } from '@/app/app-registry';
import { runCommand } from '@/app/command-registry';
import { installShortcutDispatcher } from '@/app/shortcut-dispatcher';
import { aMinorRiff } from '@/test/a-minor-riff';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { createTestServices } from '@/test/services';

import { arpeggioOverlayFor } from './fretboard/arpeggio-overlay';
import { scaleOverlayFor } from './fretboard/scale-overlay';
import { speedTrainerFor } from './speed-trainer/speed-trainer-for';
import { tunerFor } from './tuner/tuner-for';

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  const { bytes } = await write(fourBars(), 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const first = services.document.getState().score?.masterBars[0];
  if (!first) throw new Error('no bar');
  const loop = () => {
    services.fakeAudio.setLoop({ startBar: first.id, endBar: first.id });
  };
  return { services, registry, loop, trainer: speedTrainerFor(services) };
}

describe('trainer commands', () => {
  it('list in the palette with their titles and shortcuts', async () => {
    const { registry } = await setup();
    const find = (id: string) => registry.get(id);
    expect(find('trainer.speedTrainerToggle')).toMatchObject({
      title: 'Start, hold or resume speed trainer',
      shortcut: { key: 's', alt: true },
    });
    expect(find('trainer.speedTrainerMissed')).toMatchObject({
      title: 'Mark speed trainer pass missed',
      shortcut: { key: 'x', alt: true },
    });
    expect(find('trainer.speedTrainerReset')).toMatchObject({
      title: 'Reset speed trainer',
      shortcut: { key: 's', alt: true, shift: true },
    });
    expect(find('trainer.speedTrainer')?.shortcut).toBeUndefined();
    expect(find('trainer.tunerToggle')).toMatchObject({ title: 'Start or stop tuner' });
    expect(find('trainer.tunerToggle')?.shortcut).toBeUndefined();
  });

  it('the tuner toggle shows the panel and flips whether the tuner is wanted', async () => {
    const { services, registry } = await setup();
    await registry.get('trainer.tunerToggle')?.run();
    expect(services.ui.getState().rightPanelView).toBe('tuner');
    expect(tunerFor(services).getState().wanted).toBe(true);
    await registry.get('trainer.tunerToggle')?.run();
    expect(tunerFor(services).getState().wanted).toBe(false);
  });

  it('toggle shows the panel, starts, holds and resumes', async () => {
    const { services, registry, loop, trainer } = await setup();
    loop();
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
    expect(trainer.getState().status).toBe('running');
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(trainer.getState().status).toBe('held');
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(trainer.getState().status).toBe('running');
  });

  it('toggle with no loop only shows the panel and says why', async () => {
    const { services, registry, trainer } = await setup();
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(trainer.getState().status).toBe('idle');
    expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
    expect(services.transport.getState().announcement?.text).toBe('Loop some bars first');
  });

  it('missed and reset act on a run', async () => {
    const { registry, loop, trainer } = await setup();
    loop();
    await registry.get('trainer.speedTrainerMissed')?.run();
    expect(trainer.getState().missed).toBe(false);
    await registry.get('trainer.speedTrainerToggle')?.run();
    await registry.get('trainer.speedTrainerMissed')?.run();
    expect(trainer.getState().missed).toBe(true);
    await registry.get('trainer.speedTrainerReset')?.run();
    expect(trainer.getState().status).toBe('idle');
  });

  it('run from the keyboard, by physical key under the Option dead keys on macOS', async () => {
    const { registry, loop, trainer } = await setup();
    loop();
    const uninstall = installShortcutDispatcher(window, registry, 'mac');
    try {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ß', code: 'KeyS', altKey: true, cancelable: true }),
      );
      expect(trainer.getState().status).toBe('running');
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '≈', code: 'KeyX', altKey: true, cancelable: true }),
      );
      expect(trainer.getState().missed).toBe(true);
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Í',
          code: 'KeyS',
          altKey: true,
          shiftKey: true,
          cancelable: true,
        }),
      );
      expect(trainer.getState().status).toBe('idle');
    } finally {
      uninstall();
    }
  });

  describe('in the practice mode', () => {
    it('start the trainer, the click and the tuner without opening a panel or leaving', async () => {
      const { services, registry, loop, trainer } = await setup();
      loop();
      services.ui.getState().enterPracticeMode('play');
      const run = (id: string) => {
        const command = registry.get(id);
        if (!command) throw new Error(`no command ${id}`);
        runCommand(command);
      };
      run('trainer.speedTrainerToggle');
      expect(trainer.getState().status).toBe('running');
      run('trainer.metronomeToggle');
      expect(services.fakeAudio.startClick).toHaveBeenCalled();
      run('trainer.tunerToggle');
      expect(services.ui.getState().practiceMode.on).toBe(true);
      expect(services.ui.getState().panels.rightPanel).toBe(false);
    });

    it('still leave the mode and show the panel for the explicit Show commands', async () => {
      const { services, registry } = await setup();
      services.ui.getState().enterPracticeMode('play');
      const show = registry.get('trainer.speedTrainer');
      if (show) runCommand(show);
      expect(services.ui.getState().practiceMode.on).toBe(false);
      expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
    });
  });

  describe('on the menu target', () => {
    it('loop the right-clicked bar, show the speed trainer and start it', async () => {
      const { services, registry, trainer } = await setup();
      const bar = services.document.getState().score?.masterBars[2];
      if (!bar) throw new Error('no bar');
      services.menuTarget.getState().set({ kind: 'bar', masterBar: bar.id, track: undefined });
      expect(registry.get('trainer.speedTrainerOnSelection')?.enabled?.()).toBe(true);
      await registry.get('trainer.speedTrainerOnSelection')?.run();
      expect(services.playback.getState().settings.loop).toEqual({
        startBar: bar.id,
        endBar: bar.id,
      });
      expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
      expect(trainer.getState().status).toBe('running');
      expect(trainer.getState().range).toEqual({ startBar: bar.id, endBar: bar.id });
    });

    it('start a run already going over the new bar', async () => {
      const { services, registry, loop, trainer } = await setup();
      loop();
      trainer.getState().start();
      const bar = services.document.getState().score?.masterBars[3];
      if (!bar) throw new Error('no bar');
      services.menuTarget.getState().set({ kind: 'bar', masterBar: bar.id, track: undefined });
      await registry.get('trainer.speedTrainerOnSelection')?.run();
      expect(trainer.getState().range).toEqual({ startBar: bar.id, endBar: bar.id });
      expect(trainer.getState().status).toBe('running');
    });

    it('are disabled with no bar, and do nothing', async () => {
      const { services, registry, trainer } = await setup();
      const command = registry.get('trainer.speedTrainerOnSelection');
      expect(command?.enabled?.()).toBe(false);
      await command?.run();
      expect(trainer.getState().status).toBe('idle');
      expect(services.playback.getState().settings.loop).toBeUndefined();
    });

    it('show the fretboard of the right-clicked track, keeping a loop the beat lies outside', async () => {
      const { services, registry, loop } = await setup();
      loop();
      const score = services.document.getState().score;
      const beat = score?.tracks[0]?.bars[2]?.voices[0]?.beats[1];
      const bar = score?.masterBars[2];
      const first = score?.masterBars[0];
      if (!beat || !bar || !first) throw new Error('no beat');
      services.menuTarget
        .getState()
        .set({ kind: 'beat', beat: beat.id, track: 'other-track', masterBar: bar.id });
      await registry.get('trainer.showFretboard')?.run();
      expect(services.playback.getState().settings.loop).toEqual({
        startBar: first.id,
        endBar: first.id,
      });
      expect(services.selection.getState().currentTrack).toBe('other-track');
      expect(services.ui.getState().bottomPanel).toEqual({ open: true, view: 'fretboard' });
    });

    it('show the fretboard, never hiding it, and move a stopped playhead to a beat', async () => {
      const { services, registry } = await setup();
      const score = services.document.getState().score;
      const beat = score?.tracks[0]?.bars[2]?.voices[0]?.beats[1];
      const bar = score?.masterBars[2];
      if (!beat || !bar) throw new Error('no beat');
      const show = registry.get('trainer.showFretboard');
      services.menuTarget
        .getState()
        .set({ kind: 'beat', beat: beat.id, track: 'x', masterBar: bar.id });
      await show?.run();
      expect(services.ui.getState().bottomPanel).toEqual({ open: true, view: 'fretboard' });
      expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(2 * 3840 + 960);
      await show?.run();
      expect(services.ui.getState().bottomPanel).toEqual({ open: true, view: 'fretboard' });
      services.fakeAudio.seek.mockClear();
      services.menuTarget.getState().set({ kind: 'bar', masterBar: bar.id, track: undefined });
      await show?.run();
      expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    });
  });

  it('flip the fretboard for a left-handed player, and keep the choice', async () => {
    window.localStorage.clear();
    const { services, registry } = await setup();
    const flip = registry.get('trainer.fretboardLeftHanded');
    expect(services.ui.getState().fretboardLeftHanded).toBe(false);
    await flip?.run();
    expect(services.ui.getState().fretboardLeftHanded).toBe(true);
    expect(createTestServices().ui.getState().fretboardLeftHanded).toBe(true);
    await flip?.run();
    expect(services.ui.getState().fretboardLeftHanded).toBe(false);
    window.localStorage.clear();
  });

  it("shows the song's scale on the fretboard and clears it again", async () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const { bytes } = await write(aMinorRiff(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('riff.reprise', bytes);
    });
    const store = scaleOverlayFor(services);
    const clear = registry.get('trainer.fretboardClearScale');
    expect(clear?.enabled?.()).toBe(false);
    await registry.get('trainer.fretboardSongScale')?.run();
    expect(store.getState().overlay).toMatchObject({
      tonic: 9,
      scaleId: 'minorPentatonic',
      source: 'song',
    });
    expect(services.ui.getState().bottomPanel.open).toBe(true);
    expect(clear?.enabled?.()).toBe(true);
    await clear?.run();
    expect(store.getState().overlay).toBeUndefined();
    expect(registry.get('trainer.fretboardSongScale')?.shortcut).toBeUndefined();
    expect(clear?.shortcut).toBeUndefined();
  });

  it('toggles the arpeggio overlay, opens the fretboard and has no key', async () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const command = registry.get('trainer.fretboardArpeggio');
    expect(command?.title).toBe('Toggle arpeggio on the fretboard');
    expect(command?.shortcut).toBeUndefined();
    expect(command?.enabled?.()).toBe(false);
    const { bytes } = await write(fourBars(), 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    expect(command?.enabled?.()).toBe(true);
    const store = arpeggioOverlayFor(services);
    await command?.run();
    expect(store.getState().on).toBe(true);
    expect(services.ui.getState().bottomPanel.open).toBe(true);
    await command?.run();
    expect(store.getState().on).toBe(false);
    // On with the dock closed: the command brings the dock back instead of hiding unseen.
    await command?.run();
    act(() => {
      services.ui.getState().setBottomPanelOpen(false);
    });
    await command?.run();
    expect(store.getState().on).toBe(true);
    expect(services.ui.getState().bottomPanel.open).toBe(true);
    await command?.run();
    expect(store.getState().on).toBe(false);
  });

  it('says so when no scale can be named for the song', async () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const { bytes } = await write(
      score().tempo(120).track('guitar').bar().beat('4', []).build(),
      'reprise',
    );
    await act(async () => {
      await services.document.getState().openBytes('empty.reprise', bytes);
    });
    await registry.get('trainer.fretboardSongScale')?.run();
    expect(scaleOverlayFor(services).getState().overlay).toBeUndefined();
    expect(services.transport.getState().announcement?.text).toBe('No scale found for this song');
  });

  it('shows the song insights in the Song tab', async () => {
    const { services, registry } = await setup();
    await registry.get('trainer.insights')?.run();
    expect(services.ui.getState().rightPanelView).toBe('insights');
    expect(registry.get('trainer.insights')?.shortcut).toBeUndefined();
  });

  it('the chord shapes command opens the Chords tab on the right-clicked chord', async () => {
    const { services, registry } = await setup();
    await registry.get('trainer.chords')?.run();
    expect(services.ui.getState().rightPanelView).toBe('chords');
    expect(services.ui.getState().chordsName).toBe('');
    const beat = services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats[0];
    const track = services.document.getState().score?.tracks[0];
    const bar = services.document.getState().score?.masterBars[0];
    if (!beat || !track || !bar) throw new Error('no beat');
    // A chord on the first beat, as the song's own.
    act(() => {
      services.document
        .getState()
        .apply(setBeatEffect({ beatId: beat.id }, { chord: { name: 'Dm' } }));
    });
    services.menuTarget
      .getState()
      .set({ kind: 'chord', beat: beat.id, track: track.id, masterBar: bar.id });
    await registry.get('trainer.chordShapesFor')?.run();
    expect(services.ui.getState().chordsName).toBe('Dm');
  });

  it('the section insights command opens the view and asks for the right-clicked section', async () => {
    const { services, registry } = await setup();
    const bar = services.document.getState().score?.masterBars[1];
    if (!bar) throw new Error('no bar');
    services.menuTarget.getState().set({ kind: 'section', masterBar: bar.id });
    await registry.get('trainer.sectionInsights')?.run();
    expect(services.ui.getState().rightPanelView).toBe('insights');
    expect(insightsFor(services).getState().focus).toMatchObject({ bar: 1 });
    expect(registry.get('trainer.sectionInsights')?.shortcut).toBeUndefined();
  });
});
