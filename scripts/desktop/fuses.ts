/**
 * The Electron fuses the packaged app must ship with, and the helpers the smoke uses to check
 * them. The fuses themselves are set by `electronFuses` in apps/desktop/electron-builder.yml.
 */
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { flipFuses, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';

// The state bytes in the fuse wire, '0' and '1'. The package keeps its FuseState enum internal.
export const FUSE_DISABLED = 0x30;
export const FUSE_ENABLED = 0x31;

/** What ships: every hardening fuse the app asks for, by name. The rest stay at their defaults. */
export const EXPECTED_FUSES: readonly (readonly [FuseV1Options, boolean])[] = [
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
  [FuseV1Options.GrantFileProtocolExtraPrivileges, false],
];

/** The wire as `getCurrentFuseWire` returns it: fuse index to its state byte (0x30 off, 0x31 on). */
export type FuseWire = Partial<Record<FuseV1Options, unknown>>;

function stateName(state: unknown): string {
  if (state === FUSE_ENABLED) return 'on';
  if (state === FUSE_DISABLED) return 'off';
  return String(state);
}

/** One line per fuse that is not as expected; empty when the wire matches. */
export function fuseMismatches(wire: FuseWire): string[] {
  const problems: string[] = [];
  for (const [fuse, want] of EXPECTED_FUSES) {
    const got = wire[fuse];
    if (got !== (want ? FUSE_ENABLED : FUSE_DISABLED)) {
      problems.push(`${FuseV1Options[fuse]} is ${stateName(got)}, expected ${want ? 'on' : 'off'}`);
    }
  }
  return problems;
}

/** The unpacked app folder electron-builder leaves in the release folder, per platform. */
export function unpackedAppDir(release: string, platform: string, arch: string): string {
  if (platform === 'darwin') return join(release, arch === 'arm64' ? 'mac-arm64' : 'mac');
  if (platform === 'win32') return join(release, 'win-unpacked');
  throw new Error(`pnpm desktop:build makes no unpacked app on ${platform}`);
}

/** The executable inside an unpacked app folder (or a copy of its `Reprise.app` / folder). */
export function executableIn(appDir: string, platform: string): string {
  if (platform === 'darwin') return join(appDir, 'Reprise.app/Contents/MacOS/Reprise');
  if (platform === 'win32') return join(appDir, 'Reprise.exe');
  throw new Error(`no packaged app on ${platform}`);
}

/** The path `@electron/fuses` flips: the `.app` bundle on macOS, the executable elsewhere. */
export function fuseTarget(appDir: string, platform: string): string {
  return platform === 'darwin' ? join(appDir, 'Reprise.app') : executableIn(appDir, platform);
}

export async function readFuseWire(appDir: string): Promise<FuseWire> {
  return getCurrentFuseWire(fuseTarget(appDir, process.platform));
}

/**
 * Copies the unpacked app into `destination` and turns EnableNodeCliInspectArguments back on in
 * the copy, which Playwright's `_electron.launch` needs (it attaches with `--inspect=0`). The copy
 * has the same asar, the same other fuses and the same sandbox, so it differs from the shipped
 * app by that one fuse. Returns the copy's folder.
 */
export async function copyWithInspectEnabled(appDir: string, destination: string): Promise<string> {
  await cp(appDir, destination, { recursive: true, verbatimSymlinks: true });
  await flipFuses(fuseTarget(destination, process.platform), {
    version: FuseVersion.V1,
    // Flipping breaks the signature; re-sign ad hoc so macOS arm64 will still run the copy.
    resetAdHocDarwinSignature: process.platform === 'darwin',
    [FuseV1Options.EnableNodeCliInspectArguments]: true,
  });
  return destination;
}
