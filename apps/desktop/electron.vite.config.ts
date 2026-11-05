import { fileURLToPath } from 'node:url';

import { defineConfig } from 'electron-vite';

import webConfig from '../web/vite.config';

const webRoot = fileURLToPath(new URL('../web', import.meta.url));

export default defineConfig({
  main: {},
  preload: {
    build: {
      // A sandboxed preload runs as a classic script, so it must be CommonJS.
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    ...webConfig,
    root: webRoot,
    build: {
      outDir: fileURLToPath(new URL('out/renderer', import.meta.url)),
      rolldownOptions: { input: fileURLToPath(new URL('../web/index.html', import.meta.url)) },
    },
  },
});
