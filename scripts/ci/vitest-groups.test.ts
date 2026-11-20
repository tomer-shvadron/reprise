/**
 * CI runs the unit tests as a matrix of project groups (the `unit` job in ci.yml). A Vitest project
 * that is in no group would silently stop running in CI, and one in two groups would run twice, so
 * this compares the matrix with the projects vitest.config.ts declares.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import config from '../../vitest.config.ts';
import { projectNames } from './vitest-groups.ts';

const ROOT = join(import.meta.dirname, '..', '..');

function groupedProjects(): { group: string; projects: string[] }[] {
  const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const groups: { group: string; projects: string[] }[] = [];
  const entry = /^\s+- group: (\S+)\n\s+projects: (.+)$/gm;
  for (const match of workflow.matchAll(entry)) {
    groups.push({ group: match[1] ?? '', projects: (match[2] ?? '').trim().split(/\s+/) });
  }
  return groups;
}

describe('the unit job matrix in ci.yml', () => {
  const { names: declared, unnamed } = projectNames(config.test?.projects ?? []);
  const groups = groupedProjects();
  const listed = groups.flatMap((entry) => entry.projects);

  it('finds the projects and the groups', () => {
    expect(declared.length).toBeGreaterThan(0);
    expect(groups.length).toBeGreaterThan(1);
  });

  it('can name every project in the config', () => {
    expect(unnamed).toEqual([]);
  });

  it('puts every Vitest project in a group', () => {
    expect(declared.filter((name) => !listed.includes(name))).toEqual([]);
  });

  it('puts no project in two groups', () => {
    expect(listed.filter((name, index) => listed.indexOf(name) !== index)).toEqual([]);
  });

  it('lists no project vitest.config.ts does not declare', () => {
    expect(listed.filter((name) => !declared.includes(name))).toEqual([]);
  });
});

describe('projectNames', () => {
  it('reports a string entry and an entry without test.name instead of skipping it', () => {
    const { names, unnamed } = projectNames([
      { test: { name: 'web' } },
      'packages/*',
      { test: { root: 'x' } },
      {},
    ]);
    expect(names).toEqual(['web']);
    expect(unnamed).toEqual([1, 2, 3]);
  });
});
