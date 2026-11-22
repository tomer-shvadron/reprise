import { describe, expect, it } from 'vitest';

import { PPQ } from '@reprise/model';
import type { Beat, Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { drive, manualTicker } from './offline-driver';
import { RecordingSink } from './recording-sink';
import { createTransport } from './transport';

const SAMPLE_RATE = 44_100;
const LATENCY = 0.1;
const bend = {
  kind: 'bend' as const,
  points: [
    { position: 0, value: 0 },
    { position: 60, value: 4 },
  ],
};

/** Half notes at 120 BPM (1 s each), so no preview is stretched to its minimum length. */
function effects(): Score {
  return score()
    .tempo(120)
    .track('guitar')
    .bar()
    .beat('2', [note(1, 5, { bend, vibrato: 'wide' }), note(2, 7, { palmMute: true })])
    .beat('2', [note(3, 5, { slide: ['legato'] })], {
      effects: { golpe: 'thumb', wah: 'closed' },
    })
    .bar()
    .beat('2', [note(3, 7, { hammerPull: true })])
    .rest('2', { effects: { golpe: 'finger' } })
    .build();
}

function beatsOf(song: Score): Beat[] {
  return (song.tracks[0]?.bars ?? []).flatMap((bar) => bar.voices.flatMap((v) => v.beats));
}

function harness(song: Score, seconds: number) {
  const context = new OfflineAudioContext({
    numberOfChannels: 1,
    length: Math.ceil(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const sink = new RecordingSink(context);
  const scheduler = manualTicker();
  const frames = manualTicker();
  const transport = createTransport({
    context,
    sink,
    metronome: sink,
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: LATENCY,
  });
  transport.load(song);
  const render = () => drive(context, { tickers: [scheduler, frames], actions: [] });
  return Promise.resolve({ transport, sink, render });
}

/** What a sink event says about the beat, minus where on the clock and the run it was played. */
function shape(event: {
  note: unknown;
  beat: { id: string };
  durationTicks: number;
  duration: number;
  continuations: readonly { durationTicks: number }[];
  nextOnString: unknown;
  when: number;
}) {
  return {
    note: event.note,
    beat: event.beat.id,
    durationTicks: event.durationTicks,
    duration: Math.round(event.duration * 1000),
    links: event.continuations.length,
    next: event.nextOnString !== undefined,
  };
}

describe('Transport.previewBeat', () => {
  it.each([0, 1, 2])(
    'sends the notes, golpe and wah of beat %i as playback does, flagged as a preview',
    async (index) => {
      const song = effects();
      const beat = beatsOf(song)[index];
      const trackId = song.tracks[0]?.id;
      if (!beat || !trackId) throw new Error('fixture');

      const played = await harness(song, 6);
      played.transport.play();
      await played.render();
      const previewed = await harness(song, 6);
      previewed.transport.previewBeat(trackId, beat.id);

      const ownNotes = played.sink.notes.filter((n) => n.beat.id === beat.id);
      expect(previewed.sink.notes.map(shape)).toEqual(ownNotes.map(shape));
      expect(previewed.sink.notes.every((n) => n.preview === true)).toBe(true);
      expect(played.sink.notes.every((n) => n.preview === undefined)).toBe(true);
      const hits = played.sink.hits.filter((h) => h.beat.id === beat.id);
      expect(previewed.sink.hits.map((h) => [h.golpe, h.preview])).toEqual(
        hits.map((h) => [h.golpe, true]),
      );
      const wantWah = played.sink.wahs
        .filter((w) => !w.restore && w.playbackTick === ownNotes[0]?.playbackTick)
        .map((w) => w.state);
      expect(previewed.sink.wahs.filter((w) => !w.restore).map((w) => w.state)).toEqual(wantWah);
      // Everything sounds from now plus the start latency, at the beat's own tempo.
      for (const n of previewed.sink.notes) expect(n.when).toBeCloseTo(LATENCY, 6);
    },
  );

  it('sends nothing else: no mixer change, click, cut or note of another beat', async () => {
    const song = effects();
    const beat = beatsOf(song)[0];
    const trackId = song.tracks[0]?.id;
    if (!beat || !trackId) throw new Error('fixture');
    const h = await harness(song, 3);
    h.transport.previewBeat(trackId, beat.id);
    expect(h.sink.notes.map((n) => n.beat.id)).toEqual([beat.id, beat.id]);
    expect(h.sink.mixes).toHaveLength(0);
    expect(h.sink.clicks).toHaveLength(0);
    expect(h.sink.cuts).toHaveLength(0);
  });

  it('plays a rest with a golpe as the golpe only, and a plain rest as nothing', async () => {
    const song = effects();
    const [, , , rest] = beatsOf(song);
    const trackId = song.tracks[0]?.id;
    if (!rest || !trackId) throw new Error('fixture');
    const h = await harness(song, 3);
    h.transport.previewBeat(trackId, rest.id);
    expect(h.sink.notes).toHaveLength(0);
    expect(h.sink.hits.map((hit) => hit.golpe)).toEqual(['finger']);
  });

  it('lets a short beat ring for the minimum length', async () => {
    const song = score()
      .tempo(240)
      .track('guitar')
      .bar()
      .beat('8', [note(1, 3)])
      .build();
    const beat = beatsOf(song)[0];
    const trackId = song.tracks[0]?.id;
    if (!beat || !trackId) throw new Error('fixture');
    const h = await harness(song, 3);
    h.transport.previewBeat(trackId, beat.id);
    expect(h.sink.notes[0]?.duration).toBeCloseTo(0.6, 9);
    expect(h.sink.notes[0]?.durationTicks).toBe(PPQ / 2);
  });

  it('ignores a track or beat the loaded song lacks', async () => {
    const song = effects();
    const h = await harness(song, 3);
    h.transport.previewBeat('nope', 'nope');
    expect(h.sink.notes).toHaveLength(0);
  });

  it('undoes a pedal it engaged when nothing is playing', async () => {
    const song = effects();
    const beat = beatsOf(song)[1];
    const trackId = song.tracks[0]?.id;
    if (!beat || !trackId) throw new Error('fixture');
    const h = await harness(song, 3);
    h.transport.previewBeat(trackId, beat.id);
    expect(h.sink.wahs.map((w) => [w.state, w.restore])).toEqual([
      ['closed', false],
      ['off', true],
    ]);
  });

  it('leaves a running song alone: no pedal change, no cut, its notes still come', async () => {
    const song = effects();
    const beat = beatsOf(song)[1];
    const trackId = song.tracks[0]?.id;
    if (!beat || !trackId) throw new Error('fixture');
    const h = await harness(song, 6);
    h.transport.play();
    h.transport.previewBeat(trackId, beat.id);
    await h.render();
    const previewed = h.sink.notes.filter((n) => n.preview);
    expect(previewed.map((n) => n.beat.id)).toEqual([beat.id]);
    expect(h.sink.notes.filter((n) => !n.preview)).toHaveLength(4);
    expect(h.sink.wahs.filter((w) => w.state === 'closed')).toHaveLength(1);
    expect(h.sink.cuts).toHaveLength(0);
  });
});
