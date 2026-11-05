import { describe, expect, it } from 'vitest';

import { isAppUrl } from './app-url';

describe('isAppUrl', () => {
  const dev = 'http://localhost:5173/';
  const packaged =
    'file:///Applications/Reprise.app/Contents/Resources/app.asar/out/renderer/index.html';

  it('accepts any page of the dev server and nothing else', () => {
    expect(isAppUrl(dev, 'http://localhost:5173/')).toBe(true);
    expect(isAppUrl(dev, 'http://localhost:5173/?t=1#/library')).toBe(true);
    expect(isAppUrl(dev, 'http://localhost:5174/')).toBe(false);
    expect(isAppUrl(dev, 'https://localhost:5173/')).toBe(false);
    expect(isAppUrl(dev, 'http://example.com/')).toBe(false);
  });

  it('accepts only the packaged renderer file, ignoring query and fragment', () => {
    expect(isAppUrl(packaged, packaged)).toBe(true);
    expect(isAppUrl(packaged, `${packaged}?x=1#/library`)).toBe(true);
    expect(isAppUrl(packaged, packaged.replace('index.html', 'other.html'))).toBe(false);
    expect(isAppUrl(packaged, 'file:///etc/passwd')).toBe(false);
    expect(isAppUrl(packaged, 'http://localhost:5173/')).toBe(false);
  });

  it('rejects what is not a URL', () => {
    expect(isAppUrl(dev, 'not a url')).toBe(false);
    expect(isAppUrl(dev, 'javascript:alert(1)')).toBe(false);
    expect(isAppUrl(dev, '')).toBe(false);
  });
});
