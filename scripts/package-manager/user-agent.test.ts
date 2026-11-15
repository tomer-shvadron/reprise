import { describe, expect, it } from 'vitest';

import { packageManagerOf, packageManagerProblem } from './user-agent.ts';

const PNPM = 'pnpm/11.4.0 npm/? node/v24.18.0 darwin arm64';
const NPM = 'npm/11.6.2 node/v24.18.0 darwin arm64 workspaces/false';
const YARN = 'yarn/1.22.22 npm/? node/v24.18.0 darwin arm64';
const BUN = 'bun/1.2.0 npm/? node/v24.3.0 linux x64';

describe('packageManagerOf', () => {
  it('reads the first product of the user agent', () => {
    expect(packageManagerOf(PNPM)).toBe('pnpm');
    expect(packageManagerOf(NPM)).toBe('npm');
    expect(packageManagerOf(YARN)).toBe('yarn');
    expect(packageManagerOf(BUN)).toBe('bun');
  });

  it('has none for an unset or empty user agent', () => {
    expect(packageManagerOf(undefined)).toBeUndefined();
    expect(packageManagerOf('')).toBeUndefined();
    expect(packageManagerOf('  ')).toBeUndefined();
  });
});

describe('packageManagerProblem', () => {
  it('lets pnpm install, and a script run by hand', () => {
    expect(packageManagerProblem(PNPM, 'pnpm@11.4.0')).toBeUndefined();
    expect(packageManagerProblem(undefined, 'pnpm@11.4.0')).toBeUndefined();
  });

  it('stops every other package manager, naming it and the pin', () => {
    for (const [agent, name] of [
      [NPM, 'npm'],
      [YARN, 'yarn'],
      [BUN, 'bun'],
    ] as const) {
      const problem = packageManagerProblem(agent, 'pnpm@11.4.0');
      expect(problem).toContain(`started by ${name}`);
      expect(problem).toContain('pnpm@11.4.0');
      expect(problem).toContain('corepack enable pnpm');
    }
  });

  it('still stops npm when package.json has no pin', () => {
    expect(packageManagerProblem(NPM, undefined)).toContain('pins pnpm)');
  });
});
