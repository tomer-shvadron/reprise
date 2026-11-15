import { describe, expect, it, vi } from 'vitest';

import { decideMediaPermission } from './media-permission';

const deps = (platform: NodeJS.Platform, allowed = true) => ({
  platform,
  askForMicrophone: vi.fn(() => Promise.resolve(allowed)),
});

describe('decideMediaPermission', () => {
  it('refuses anything but media', async () => {
    const d = deps('win32');
    expect(await decideMediaPermission('geolocation', { mediaTypes: ['audio'] }, d)).toBe(false);
  });

  it('refuses a request with no media types, or with video among them', async () => {
    const d = deps('win32');
    expect(await decideMediaPermission('media', {}, d)).toBe(false);
    expect(await decideMediaPermission('media', { mediaTypes: [] }, d)).toBe(false);
    expect(await decideMediaPermission('media', { mediaTypes: ['video'] }, d)).toBe(false);
    expect(await decideMediaPermission('media', { mediaTypes: ['audio', 'video'] }, d)).toBe(false);
  });

  it('allows audio on Windows and Linux without asking the system', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const d = deps(platform);
      expect(await decideMediaPermission('media', { mediaTypes: ['audio'] }, d)).toBe(true);
      expect(d.askForMicrophone).not.toHaveBeenCalled();
    }
  });

  it('follows the system answer on macOS', async () => {
    expect(
      await decideMediaPermission('media', { mediaTypes: ['audio'] }, deps('darwin', true)),
    ).toBe(true);
    expect(
      await decideMediaPermission('media', { mediaTypes: ['audio'] }, deps('darwin', false)),
    ).toBe(false);
  });

  it('refuses on macOS when the system prompt fails', async () => {
    const d = { platform: 'darwin' as const, askForMicrophone: () => Promise.reject(new Error()) };
    expect(await decideMediaPermission('media', { mediaTypes: ['audio'] }, d)).toBe(false);
  });
});
