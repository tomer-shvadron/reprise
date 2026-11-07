import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { GENERATED, GM_BANK, generateScores } from './scores';

export default async function globalSetup(): Promise<void> {
  if (!existsSync(GM_BANK)) {
    throw new Error('The GM sound bank is missing: run `pnpm sounds:fetch` first');
  }
  mkdirSync(GENERATED, { recursive: true });
  for (const [name, bytes] of Object.entries(await generateScores())) {
    writeFileSync(`${GENERATED}${name}`, bytes);
  }
}
