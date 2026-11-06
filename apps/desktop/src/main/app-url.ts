/**
 * Whether `url` is the app's own document: a page of the dev server's origin, or of the app
 * scheme's host. Anything else is foreign to the window.
 */
export function isAppUrl(appUrl: string, url: string): boolean {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  const own = new URL(appUrl);
  // Node gives every non-special scheme the origin "null", so comparing origins would accept
  // data:, javascript: and any foo:// URL; protocol and host pin the app instead.
  return own.host !== '' && target.protocol === own.protocol && target.host === own.host;
}
