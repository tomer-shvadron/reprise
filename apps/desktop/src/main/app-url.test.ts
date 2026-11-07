import { describe, expect, it } from 'vitest';

import { isAppUrl } from './app-url';

describe('isAppUrl', () => {
  const dev = 'http://localhost:5173/';
  const packaged = 'reprise://app/index.html';

  it('accepts any page of the dev server and nothing else', () => {
    expect(isAppUrl(dev, 'http://localhost:5173/')).toBe(true);
    expect(isAppUrl(dev, 'http://localhost:5173/?t=1#/library')).toBe(true);
    expect(isAppUrl(dev, 'http://localhost:5174/')).toBe(false);
    expect(isAppUrl(dev, 'https://localhost:5173/')).toBe(false);
    expect(isAppUrl(dev, 'http://example.com/')).toBe(false);
  });

  it("accepts any page of the app scheme's host and nothing else", () => {
    expect(isAppUrl(packaged, packaged)).toBe(true);
    expect(isAppUrl(packaged, `${packaged}?x=1#/library`)).toBe(true);
    expect(isAppUrl(packaged, 'reprise://app/')).toBe(true);
    expect(isAppUrl(packaged, 'reprise://other/index.html')).toBe(false);
    expect(
      isAppUrl(
        packaged,
        'file:///Applications/Reprise.app/Contents/Resources/app.asar/out/renderer/index.html',
      ),
    ).toBe(false);
    expect(isAppUrl(packaged, 'http://localhost:5173/')).toBe(false);
  });

  it('does not treat two opaque origins as one', () => {
    expect(isAppUrl(packaged, 'data:text/html,<p>x</p>')).toBe(false);
    expect(isAppUrl(packaged, 'evil://app/index.html')).toBe(false);
    expect(isAppUrl(packaged, 'javascript:alert(1)')).toBe(false);
    expect(isAppUrl('file:///index.html', 'file:///etc/passwd')).toBe(false);
  });

  it('rejects what is not a URL', () => {
    expect(isAppUrl(dev, 'not a url')).toBe(false);
    expect(isAppUrl(dev, 'javascript:alert(1)')).toBe(false);
    expect(isAppUrl(dev, '')).toBe(false);
  });
});
