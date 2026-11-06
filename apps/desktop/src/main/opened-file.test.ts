import { describe, expect, it, vi } from 'vitest';

import { openedFile } from './opened-file';

describe('openedFile', () => {
  it('returns the picked path as the handle, after granting it', async () => {
    const grant = vi.fn();
    const read = vi.fn(() => Promise.resolve(new Uint8Array([7])));

    const opened = await openedFile(
      { canceled: false, filePaths: ['/Users/me/Songs/song.gp'] },
      { grant },
      read,
    );

    expect(opened).toEqual({
      name: 'song.gp',
      bytes: new Uint8Array([7]),
      handle: '/Users/me/Songs/song.gp',
    });
    expect(grant).toHaveBeenCalledWith('/Users/me/Songs/song.gp');
    expect(read).toHaveBeenCalledWith('/Users/me/Songs/song.gp');
  });

  it('grants and reads nothing on a cancel', async () => {
    const grant = vi.fn();
    const read = vi.fn(() => Promise.resolve(new Uint8Array()));

    expect(await openedFile({ canceled: true, filePaths: ['/a.gp'] }, { grant }, read)).toBe(
      undefined,
    );
    expect(await openedFile({ canceled: false, filePaths: [] }, { grant }, read)).toBe(undefined);
    expect(grant).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
