// The Content-Security-Policy the app ships with, defined once: Electron's app protocol sends it
// as a header (apps/desktop, via electron-vite's `define`) and `vite preview` sends it so the e2e
// suite runs under the same policy. No imports, so plain Node and the Vite config can load it.

export const CSP_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'none'"],
  // No 'unsafe-inline' or 'unsafe-eval': the theme bootstrap is a file, and zod runs jitless.
  'script-src': ["'self'"],
  // Radix and cmdk inject <style> elements; React `style` props go through the CSSOM, which CSP
  // does not govern.
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  // The sound bank and the fonts load with fetch from the app's own origin.
  'connect-src': ["'self'"],
  // The audio ticker's blob worker, plus the module workers, which load from 'self'.
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
};

export function buildCsp(directives: Readonly<Record<string, readonly string[]>>): string {
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

export const CONTENT_SECURITY_POLICY = buildCsp(CSP_DIRECTIVES);
