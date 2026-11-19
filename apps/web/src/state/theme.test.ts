// The bootstrap runs under node:vm, so this one file needs the Node types the app project leaves out.
/// <reference types="node" />
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import indexHtml from '../../index.html?raw';
import bootstrapSource from '../../public/theme-bootstrap.js?raw';
import { THEME_STORAGE_KEY } from './theme';

interface Environment {
  readonly stored?: string | null;
  readonly storageThrows?: boolean;
  readonly prefersLight?: boolean;
  readonly noMatchMedia?: boolean;
}

/** Runs the bootstrap in a bare context with only the globals it may touch; returns the theme it set. */
function runBootstrap(environment: Environment): string | undefined {
  const dataset: Record<string, string> = {};
  const sandbox: Record<string, unknown> = {
    localStorage: {
      getItem: () => {
        if (environment.storageThrows) throw new Error('blocked');
        return environment.stored ?? null;
      },
    },
    document: { documentElement: { dataset } },
  };
  sandbox.window = environment.noMatchMedia
    ? {}
    : { matchMedia: () => ({ matches: environment.prefersLight === true }) };
  runInNewContext(bootstrapSource, sandbox);
  return dataset.theme;
}

describe('theme bootstrap', () => {
  it('reads the same storage key as the store', () => {
    expect(bootstrapSource).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
  });

  it('keeps a stored light or dark choice over the system preference', () => {
    expect(runBootstrap({ stored: 'light' })).toBe('light');
    expect(runBootstrap({ stored: 'dark', prefersLight: true })).toBe('dark');
  });

  it('falls back to the system preference for a missing or garbage value', () => {
    expect(runBootstrap({ stored: 'purple', prefersLight: true })).toBe('light');
    expect(runBootstrap({ stored: null, prefersLight: false })).toBe('dark');
  });

  it('survives storage that throws, and a missing matchMedia, by going dark', () => {
    expect(runBootstrap({ storageThrows: true, prefersLight: true })).toBe('light');
    expect(runBootstrap({ storageThrows: true, noMatchMedia: true })).toBe('dark');
  });
});

describe('theme bootstrap in index.html', () => {
  it('has no inline script, so the CSP needs no unsafe-inline', () => {
    const inline = [...indexHtml.matchAll(/<script\b[^>]*>/gi)].filter(
      (tag) => !/\bsrc\s*=/.test(tag[0]),
    );

    expect(inline).toEqual([]);
  });

  it('loads the bootstrap as a classic script in the head, before the app script', () => {
    const tag = '<script src="/theme-bootstrap.js"></script>';
    const headEnd = indexHtml.indexOf('</head>');

    expect(indexHtml).toContain(tag);
    expect(indexHtml.indexOf(tag)).toBeLessThan(headEnd);
    expect(indexHtml.indexOf(tag)).toBeLessThan(indexHtml.indexOf('src="/src/main.tsx"'));
  });

  it('starts dark, matching the stylesheet default until the script runs', () => {
    expect(indexHtml).toContain('<html lang="en" data-theme="dark">');
  });
});
