/**
 * Global setup of every `pnpm check:files` project: provides the file list, and for the browser
 * projects writes each file's score as a native document they fetch by index, since only Node
 * may run the readers and `provide` should not carry megabytes of scores.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { read } from '@reprise/formats';
import { serializeNative } from '@reprise/model';
import type { TestProject } from 'vitest/node';

import { ROOT_DIR } from './files.ts';
import type { CheckFile } from './meta.ts';

/** Fixed, whatever the output folder: the browser projects fetch natives from the dev server. */
const NATIVES_DIR = join(ROOT_DIR, '.check-files', 'natives');

export const FILES_ENV = 'REPRISE_CHECK_FILES';

const isEntry = (value: unknown): value is Omit<CheckFile, 'index'> =>
  typeof value === 'object' &&
  value !== null &&
  'file' in value &&
  typeof value.file === 'string' &&
  'absolute' in value &&
  typeof value.absolute === 'string' &&
  'source' in value &&
  (value.source === 'fixtures' || value.source === 'local');

/** The list `run.ts` passes through the environment. */
export function filesFromEnv(env: NodeJS.ProcessEnv = process.env): Omit<CheckFile, 'index'>[] {
  const raw = env[FILES_ENV];
  if (raw === undefined) throw new Error(`${FILES_ENV} is not set; run \`pnpm check:files\``);
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isEntry)) {
    throw new Error(`${FILES_ENV} is not a list of files`);
  }
  return parsed;
}

export default async function setup(project: TestProject): Promise<void> {
  const browser = project.config.browser.enabled;
  const dir = join(NATIVES_DIR, project.name);
  if (browser) mkdirSync(dir, { recursive: true });
  const files: CheckFile[] = [];
  for (const [index, entry] of filesFromEnv().entries()) {
    const file: CheckFile = { ...entry, index };
    try {
      const { score } = await read(new Uint8Array(readFileSync(entry.absolute)));
      if (browser) {
        writeFileSync(
          join(dir, `${String(index)}.reprise`),
          serializeNative(score, { name: 'reprise-check-files', version: '0.0.0' }),
        );
      }
    } catch (error) {
      file.readError = error instanceof Error ? error.message : String(error);
    }
    files.push(file);
  }
  project.provide('checkFiles', files);
}
