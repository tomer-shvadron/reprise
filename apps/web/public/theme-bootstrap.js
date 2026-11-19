// Runs before first paint so a light-theme user never sees a dark frame; mirrors src/state/theme.ts.
// A file, not an inline script, so the Content-Security-Policy needs no 'unsafe-inline'.
(() => {
  let theme;
  try {
    theme = localStorage.getItem('reprise.theme');
  } catch {}
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = theme;
})();
