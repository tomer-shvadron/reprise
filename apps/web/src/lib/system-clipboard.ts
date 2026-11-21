/**
 * Puts text on the system clipboard. It rejects, with a message fit for a notice, when the
 * platform refuses or has no clipboard: a copy that did nothing must never look like it worked.
 * The desktop app grants the permission to its own main frame only (`permission.ts`); the same
 * `clipboard-sanitized-write` covers `copyImage` below.
 */
export async function copyText(text: string): Promise<void> {
  // Absent in an insecure context and in some embedded browsers.
  if (typeof navigator === 'undefined' || !('clipboard' in navigator)) {
    throw new Error('this browser has no clipboard access');
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const reason = error instanceof Error && error.message !== '' ? ` (${error.message})` : '';
    throw new Error(`the clipboard refused the text${reason}`, { cause: error });
  }
}

/**
 * Puts a PNG on the system clipboard. It takes the blob as a promise: the `ClipboardItem` is made
 * at once, inside the click's user activation, and the layout and rasterising that make the image
 * finish later (Chromium rejects a write that starts after those awaits). Rejects with a message
 * fit for a notice, whether the platform refused or the image could not be made.
 */
export async function copyImage(png: Promise<Blob>): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    !('clipboard' in navigator) ||
    typeof ClipboardItem === 'undefined'
  ) {
    // Settle the promise so a failure of the image itself is not reported as unhandled.
    png.catch(() => undefined);
    throw new Error('this browser cannot copy images');
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch (error) {
    const reason = error instanceof Error && error.message !== '' ? ` (${error.message})` : '';
    throw new Error(`the clipboard refused the image${reason}`, { cause: error });
  }
}
