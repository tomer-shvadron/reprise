import { describe, expect, it, vi } from 'vitest';

import { decideMediaPermission } from './media-permission';

const APP = 'reprise://app/index.html';
const ask = { mediaTypes: ['audio'], requestingUrl: APP, isMainFrame: true };
const deps = (platform: NodeJS.Platform, allowed = true) => ({
  platform,
  isAppUrl: (url: string) => url.startsWith('reprise://app/'),
  askForMicrophone: vi.fn(() => Promise.resolve(allowed)),
});

describe('decideMediaPermission', () => {
  it('refuses anything but media', async () => {
    const d = deps('win32');
    expect(await decideMediaPermission('geolocation', ask, d)).toBe(false);
  });

  it('refuses a request with no media types, or with video among them', async () => {
    const d = deps('win32');
    expect(await decideMediaPermission('media', { requestingUrl: APP, isMainFrame: true }, d)).toBe(
      false,
    );
    expect(await decideMediaPermission('media', { ...ask, mediaTypes: [] }, d)).toBe(false);
    expect(await decideMediaPermission('media', { ...ask, mediaTypes: ['video'] }, d)).toBe(false);
    expect(
      await decideMediaPermission('media', { ...ask, mediaTypes: ['audio', 'video'] }, d),
    ).toBe(false);
  });

  it('refuses a subframe and a page that is not the app, even for audio', async () => {
    const d = deps('win32');
    expect(await decideMediaPermission('media', { ...ask, isMainFrame: false }, d)).toBe(false);
    expect(await decideMediaPermission('media', ask, d)).toBe(true);
    expect(
      await decideMediaPermission('media', { ...ask, requestingUrl: 'https://example.com/' }, d),
    ).toBe(false);
    expect(await decideMediaPermission('media', { ...ask, requestingUrl: undefined }, d)).toBe(
      false,
    );
    expect(
      await decideMediaPermission('media', { mediaTypes: ['audio'], requestingUrl: APP }, d),
    ).toBe(false);
  });

  it('allows audio on Windows and Linux without asking the system', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const d = deps(platform);
      expect(await decideMediaPermission('media', ask, d)).toBe(true);
      expect(d.askForMicrophone).not.toHaveBeenCalled();
    }
  });

  it('follows the system answer on macOS', async () => {
    expect(await decideMediaPermission('media', ask, deps('darwin', true))).toBe(true);
    expect(await decideMediaPermission('media', ask, deps('darwin', false))).toBe(false);
  });

  it('refuses on macOS when the system prompt fails', async () => {
    const d = {
      platform: 'darwin' as const,
      isAppUrl: () => true,
      askForMicrophone: () => Promise.reject(new Error()),
    };
    expect(await decideMediaPermission('media', ask, d)).toBe(false);
  });
});
