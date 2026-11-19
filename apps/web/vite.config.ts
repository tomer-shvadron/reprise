import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { CONTENT_SECURITY_POLICY } from './src/csp';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // The e2e suite runs against `vite preview`, so every flow runs under the shipped policy. `vite
  // dev` stays without one: its client injects inline scripts.
  preview: { headers: { 'Content-Security-Policy': CONTENT_SECURITY_POLICY } },
  resolve: {
    alias: { '@': fileURLToPath(new URL('src', import.meta.url)) },
  },
});
