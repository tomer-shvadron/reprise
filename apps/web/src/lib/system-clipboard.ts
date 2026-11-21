/**
 * Puts text on the system clipboard. It rejects, with a message fit for a notice, when the
 * platform refuses or has no clipboard: a copy that did nothing must never look like it worked.
 * The desktop app grants the permission to its own main frame only (`permission.ts`); image
 * export (#351) adds its own `copyImage` beside this one.
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
