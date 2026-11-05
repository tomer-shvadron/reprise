/**
 * Downloads the GM tier's soundfont, GeneralUser GS, and its license into the web app's public
 * directory, pinned by `gm.json` to one commit of the author's repository and verified by
 * SHA-256. Files already present with the right hash are left alone, so it is cheap to rerun.
 *
 *   pnpm sounds:fetch
 *
 * The author asks that his download links not be hot-linked; the GitHub repository is the source
 * he publishes "for automated packaging", and the bundle is our own local copy of it.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exit } from 'node:process';

interface BundleFile {
  name: string;
  path: string;
  bytes: number;
  sha256: string;
}

interface Bundle {
  name: string;
  version: string;
  repository: string;
  commit: string;
  target: string;
  files: BundleFile[];
}

const ROOT = join(import.meta.dirname, '../..');

function isBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'repository' in value &&
    typeof value.repository === 'string' &&
    'commit' in value &&
    typeof value.commit === 'string' &&
    'target' in value &&
    typeof value.target === 'string' &&
    'files' in value &&
    Array.isArray(value.files)
  );
}

export async function loadBundle(): Promise<Bundle> {
  const parsed: unknown = JSON.parse(await readFile(join(import.meta.dirname, 'gm.json'), 'utf8'));
  if (!isBundle(parsed)) throw new Error('scripts/sounds/gm.json is malformed');
  return parsed;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function present(path: string, file: BundleFile): Promise<boolean> {
  try {
    return sha256(await readFile(path)) === file.sha256;
  } catch {
    return false;
  }
}

/** raw.githubusercontent.com serves a pinned commit's file as is; the hash makes it exact. */
function rawUrl(bundle: Bundle, file: BundleFile): string {
  const repo = bundle.repository.replace('https://github.com/', '');
  return `https://raw.githubusercontent.com/${repo}/${bundle.commit}/${file.path}`;
}

async function main(): Promise<void> {
  const bundle = await loadBundle();
  const target = join(ROOT, bundle.target);
  await mkdir(target, { recursive: true });
  for (const file of bundle.files) {
    const destination = join(target, file.name);
    if (await present(destination, file)) {
      console.log(`${file.name}: present, hash verified`);
      continue;
    }
    const url = rawUrl(bundle, file);
    console.log(`${file.name}: downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const actual = sha256(bytes);
    if (actual !== file.sha256) {
      throw new Error(`${file.name}: SHA-256 ${actual} does not match gm.json's ${file.sha256}`);
    }
    // Written beside the target and renamed, so an interrupted run never leaves a partial file.
    const partial = `${destination}.partial`;
    await writeFile(partial, bytes);
    await rename(partial, destination);
    console.log(`${file.name}: ${String(bytes.length)} bytes, hash verified`);
  }
  console.log(`${bundle.name} ${bundle.version} is in ${bundle.target}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exit(1);
  }
}
