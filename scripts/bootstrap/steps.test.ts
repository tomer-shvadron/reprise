import { describe, expect, it } from 'vitest';

import { installSteps, major, minimums, versionProblems } from './steps.ts';

const MIN = { node: 24, pnpm: 11 };

describe('major', () => {
  it('reads node and pnpm version strings', () => {
    expect(major('v24.18.0')).toBe(24);
    expect(major('11.4.0\n')).toBe(11);
    expect(major('next')).toBeUndefined();
  });
});

describe('minimums', () => {
  it('reads >=N ranges', () => {
    expect(minimums({ node: '>=24', pnpm: '>= 11' })).toEqual(MIN);
  });

  it('rejects a range it cannot check', () => {
    expect(() => minimums({ node: '^24', pnpm: '>=11' })).toThrow('engines.node');
    expect(() => minimums({ node: '>=24' })).toThrow('engines.pnpm');
  });
});

describe('versionProblems', () => {
  it('passes at and above the minimums', () => {
    expect(versionProblems({ node: 'v24.0.0', pnpm: '11.0.0' }, MIN)).toEqual([]);
    expect(versionProblems({ node: 'v25.1.0', pnpm: '12.0.0' }, MIN)).toEqual([]);
  });

  it('names each tool that is too old or missing', () => {
    expect(versionProblems({ node: 'v22.12.0', pnpm: '11.4.0' }, MIN)).toHaveLength(1);
    expect(versionProblems({ node: 'v22.12.0', pnpm: '10.9.0' }, MIN)).toHaveLength(2);
    expect(versionProblems({ node: 'v24.1.0', pnpm: undefined }, MIN)[0]).toContain('found none');
  });
});

describe('installSteps', () => {
  it('installs before it fetches, and runs only commands the root package.json defines', () => {
    const commands = installSteps().map((step) => step.command.join(' '));
    expect(commands[0]).toBe('pnpm install');
    expect(commands.indexOf('pnpm sounds:fetch')).toBeGreaterThan(0);
  });
});
