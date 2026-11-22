import { describe, expect, it } from 'vitest';

import { readGp, readGp3To5, writeGp } from '../src/index';
import { buildGpFile } from './gp-file';

const beat = { duration: 0, notes: [{ string: 1, fret: 0 }] };

function bankOf(bank: number): number | undefined {
  const bytes = buildGpFile({
    version: '5.00',
    tracks: [{ bank }],
    bars: [[[[beat]]]],
  });
  return readGp3To5(bytes).score.tracks[0]?.bank;
}

// `Track.bank` is 14-bit, `(msb << 7) | lsb` (#411); a gp5 file's byte is its MSB.
describe('the gp5 track bank', () => {
  it('reads the bank-select byte as the MSB of a 14-bit bank', () => {
    expect(bankOf(8)).toBe(8 << 7);
    expect(bankOf(0)).toBe(0);
  });

  it('survives an export to gp as MSB 8 and LSB 0', () => {
    const read = readGp3To5(
      buildGpFile({ version: '5.00', tracks: [{ bank: 8 }], bars: [[[[beat]]]] }),
    ).score;
    const { bytes } = writeGp(read);
    expect(readGp(bytes).score.tracks[0]?.bank).toBe(8 << 7);
  });
});
