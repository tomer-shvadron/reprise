/**
 * Whether `url` is the app's own document: a page of the dev server's origin, or the packaged
 * renderer file (query and fragment ignored). Anything else is foreign to the window.
 */
export function isAppUrl(appUrl: string, url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const own = new URL(appUrl);
  if (own.protocol === 'file:') {
    return target.protocol === 'file:' && target.pathname === own.pathname;
  }
  return target.origin === own.origin;
}
