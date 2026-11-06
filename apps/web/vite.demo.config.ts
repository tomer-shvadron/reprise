import { fileURLToPath } from 'node:url';

import { mergeConfig } from 'vite';

import base from './vite.config';

// The /dev/score demo built on production React, for measurements; `vite build` never sees it.
export default mergeConfig(base, {
  build: {
    outDir: 'dist/demo',
    rolldownOptions: { input: fileURLToPath(new URL('dev/score.html', import.meta.url)) },
  },
});
