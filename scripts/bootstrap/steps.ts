export interface Minimums {
  node: number;
  pnpm: number;
}

export interface Step {
  name: string;
  command: readonly string[];
}

/** The major of `v24.18.0`, `24.18.0` or `11.4.0`; undefined when the text is not a version. */
export function major(version: string): number | undefined {
  const match = /^v?(\d+)\./.exec(version.trim());
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Reads `>=N` ranges from the `engines` field; anything else is not a minimum this script can check. */
export function minimums(engines: Readonly<Record<string, string>>): Minimums {
  const read = (key: string): number => {
    const match = /^>=\s*(\d+)/.exec(engines[key] ?? '');
    if (match?.[1] === undefined) throw new Error(`engines.${key} is not a ">=N" range`);
    return Number(match[1]);
  };
  return { node: read('node'), pnpm: read('pnpm') };
}

/** One message per tool below its minimum; empty when both pass. */
export function versionProblems(
  found: { node: string; pnpm: string | undefined },
  min: Minimums,
): string[] {
  const problems: string[] = [];
  const node = major(found.node);
  if (node === undefined || node < min.node) {
    problems.push(
      `Node ${String(min.node)} or newer is required, found ${found.node}. \`nvm use\` or \`fnm use\` reads .nvmrc.`,
    );
  }
  const pnpm = found.pnpm === undefined ? undefined : major(found.pnpm);
  if (pnpm === undefined || pnpm < min.pnpm) {
    problems.push(
      `pnpm ${String(min.pnpm)} or newer is required, found ${found.pnpm ?? 'none'}. \`corepack enable\` picks the pinned version.`,
    );
  }
  return problems;
}

/** The install steps, in order; each is cheap when its work is already done. */
export function installSteps(): Step[] {
  return [
    { name: 'Install dependencies (husky hook, Chromium shell)', command: ['pnpm', 'install'] },
    {
      name: 'Make sure the Chromium headless shell is present',
      command: ['pnpm', 'exec', 'playwright', 'install', 'chromium', '--only-shell'],
    },
    { name: 'Fetch the GM soundfont', command: ['pnpm', 'sounds:fetch'] },
  ];
}

export const NEXT_COMMANDS: readonly (readonly [string, string])[] = [
  ['pnpm dev', 'the web app on the Vite dev server'],
  ['pnpm test', 'the unit suite'],
  ['pnpm e2e', 'the player flows in Chromium'],
  ['pnpm check:files', 'the real-file pass over fixtures/ and local-tabs/'],
  ['pnpm desktop:dev', 'the Electron app around the web core'],
];
