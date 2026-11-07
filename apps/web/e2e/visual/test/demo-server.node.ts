/**
 * Vitest global setup for the visual suite: a Vite dev server for `apps/web`, so a print test can
 * open `/dev/score.html` in a page of its own. Vitest's browser server is not relied on for it.
 */
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';
import type { TestProject } from 'vitest/node';

// What the visual config provides, as the Node side sees it; the tests declare their own view.
declare module 'vitest' {
  export interface ProvidedContext {
    demoUrl: string;
    checkOrphanBaselines: boolean;
  }
}

const WEB = fileURLToPath(new URL('../../../', import.meta.url));

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const server = await createServer({
    configFile: `${WEB}vite.config.ts`,
    root: WEB,
    logLevel: 'warn',
    server: { port: 0, host: '127.0.0.1', strictPort: false },
  });
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('the demo server has no local URL');
  project.provide('demoUrl', new URL('dev/score.html', url).href);
  return () => server.close();
}
