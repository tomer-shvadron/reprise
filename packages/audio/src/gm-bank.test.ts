import { createTrack } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { beforeAll, describe, expect, it } from 'vitest';

import { GmBank } from './gm-bank';
import { GM_BUDGET_BYTES, ManagedSampleSource } from './samples/managed-sample-source';
import { planInstruments } from './samples/plan';
import { Sf2Soundfont } from './sf2/soundfont';

const SYNTHETIC = new URL('../test-fixtures/synthetic.sf2', import.meta.url);

let font: Sf2Soundfont;

beforeAll(async () => {
  font = Sf2Soundfont.parse(new Uint8Array(await (await fetch(SYNTHETIC)).arrayBuffer()));
});

function bank(): GmBank {
  const factory = {
    createBuffer: (channels: number, length: number, sampleRate: number) =>
      new AudioBuffer({ numberOfChannels: channels, length, sampleRate }),
  };
  return new GmBank(
    font,
    new ManagedSampleSource(font, factory, {
      budgetBytes: GM_BUDGET_BYTES,
      schedule: () => undefined,
    }),
  );
}

const guitar = (bankNumber: number) => createTrack('fretted', { bank: bankNumber });
const drums = createTrack('drums');

describe('GmBank', () => {
  it('names the preset the soundfont resolves, falling back as a GM player does', () => {
    const gm = bank();
    expect(gm.instrumentId(guitar(0), 25)).toBe('gm:0:25');
    expect(gm.instrumentId(guitar(8), 25)).toBe('gm:8:25');
    expect(gm.instrumentId(guitar(9), 25)).toBe('gm:0:25');
    expect(gm.instrumentId(drums, 5)).toBe('gm:drums:0');
    expect(gm.instrumentId(guitar(0), 40)).toBe('gm:0:0');
  });

  it('hands the sampler the region map the manager decodes for the same id', () => {
    const gm = bank();
    for (const [track, program] of [
      [guitar(9), 25],
      [drums, 5],
      [guitar(0), 40],
    ] as const) {
      const instrument = gm.instrument(track, program);
      expect(instrument.regions).toBe(gm.regionMap(gm.instrumentId(track, program)));
      expect(instrument.source).toBe(gm.source);
    }
  });

  it('keeps every instrument a mid-repeat program change plays resident', async () => {
    const gm = bank();
    const song = score()
      .track('guitar', { program: 25 })
      .bar()
      .repeatStart()
      .beat('4', [note(1, 0)])
      .beat('4', [note(1, 2)], { mix: { program: 0 } })
      .beat('2', [note(1, 3)])
      .repeatEnd()
      .bar()
      .beat('1', [note(2, 0)])
      .build();

    await gm.source.load(song, gm.regionMap, { instrumentOf: gm.instrumentId });
    await gm.source.settled();

    const planned = planInstruments(song, { instrumentOf: gm.instrumentId }).instruments;
    expect(planned).toEqual(expect.arrayContaining(['gm:0:25', 'gm:0:0']));
    // A preset that only shares the decoded samples (bank 8's variation of program 25) is not.
    const { residents } = gm.source.memory();
    expect(residents).toEqual([...planned].sort());
    expect(residents).not.toContain('gm:drums:0');
  });
});
