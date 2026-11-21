import { describe, expect, it, vi } from 'vitest';

import { decidePermission } from './permission';

const APP = 'reprise://app/index.html';
const ask = { mediaTypes: ['audio'], requestingUrl: APP, isMainFrame: true };
const deps = (platform: NodeJS.Platform, allowed = true) => ({
  platform,
  isAppUrl: (url: string) => url.startsWith('reprise://app/'),
  askForMicrophone: vi.fn(() => Promise.resolve(allowed)),
});

describe('decidePermission', () => {
  it('refuses anything but media', async () => {
    const d = deps('win32');
    expect(await decidePermission('geolocation', ask, d)).toBe(false);
  });

  it('refuses a request with no media types, or with video among them', async () => {
    const d = deps('win32');
    expect(await decidePermission('media', { requestingUrl: APP, isMainFrame: true }, d)).toBe(
      false,
    );
    expect(await decidePermission('media', { ...ask, mediaTypes: [] }, d)).toBe(false);
    expect(await decidePermission('media', { ...ask, mediaTypes: ['video'] }, d)).toBe(false);
    expect(await decidePermission('media', { ...ask, mediaTypes: ['audio', 'video'] }, d)).toBe(
      false,
    );
  });

  it('refuses a subframe and a page that is not the app, even for audio', async () => {
    const d = deps('win32');
    expect(await decidePermission('media', { ...ask, isMainFrame: false }, d)).toBe(false);
    expect(await decidePermission('media', ask, d)).toBe(true);
    expect(
      await decidePermission('media', { ...ask, requestingUrl: 'https://example.com/' }, d),
    ).toBe(false);
    expect(await decidePermission('media', { ...ask, requestingUrl: undefined }, d)).toBe(false);
    expect(await decidePermission('media', { mediaTypes: ['audio'], requestingUrl: APP }, d)).toBe(
      false,
    );
  });

  it('allows audio on Windows and Linux without asking the system', async () => {
    for (const platform of ['win32', 'linux'] as const) {
      const d = deps(platform);
      expect(await decidePermission('media', ask, d)).toBe(true);
      expect(d.askForMicrophone).not.toHaveBeenCalled();
    }
  });

  it('follows the system answer on macOS', async () => {
    expect(await decidePermission('media', ask, deps('darwin', true))).toBe(true);
    expect(await decidePermission('media', ask, deps('darwin', false))).toBe(false);
  });

  it('refuses on macOS when the system prompt fails', async () => {
    const d = {
      platform: 'darwin' as const,
      isAppUrl: () => true,
      askForMicrophone: () => Promise.reject(new Error()),
    };
    expect(await decidePermission('media', ask, d)).toBe(false);
  });

  describe('clipboard-sanitized-write', () => {
    const copy = { requestingUrl: APP, isMainFrame: true };

    it("is granted to the app's own top frame, on every platform, without a system prompt", async () => {
      for (const platform of ['darwin', 'win32', 'linux'] as const) {
        const d = deps(platform);
        expect(await decidePermission('clipboard-sanitized-write', copy, d)).toBe(true);
        expect(d.askForMicrophone).not.toHaveBeenCalled();
      }
    });

    it('is refused to a subframe, a page that is not the app and an unknown page', async () => {
      const d = deps('win32');
      const write = (details: typeof copy | { isMainFrame?: boolean; requestingUrl?: string }) =>
        decidePermission('clipboard-sanitized-write', details, d);
      expect(await write({ ...copy, isMainFrame: false })).toBe(false);
      expect(await write({ requestingUrl: APP })).toBe(false);
      expect(await write({ ...copy, requestingUrl: 'https://example.com/' })).toBe(false);
      expect(await write({ isMainFrame: true })).toBe(false);
    });

    it('does not grant the neighbouring permissions to the same frame', async () => {
      const d = deps('win32');
      for (const permission of [
        'clipboard-read',
        'deprecated-sync-clipboard-read',
        'geolocation',
        'notifications',
        'midi',
        'fileSystem',
        'display-capture',
        'openExternal',
        'unknown',
      ]) {
        expect(await decidePermission(permission, copy, d)).toBe(false);
      }
    });
  });
});
