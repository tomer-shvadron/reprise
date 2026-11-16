import { modalBlocksCommand } from '@/app/shortcut-dispatcher';
import { isTextField } from '@/app/text-field';

import {
  copySelection,
  cutSelection,
  pasteClip,
  pasteInternal,
  type ClipboardServices,
} from './clipboard-actions';
import { parseClip, serializeClip, type Clip } from './clipboard-format';
import type { PasteMode } from './paste';

export interface ClipboardController {
  /** The palette's Copy and Cut: raise the browser's own event so the system clipboard is filled too. */
  copy(): void;
  cut(): void;
  /** The palette's Paste: the internal clipboard only, a page cannot trigger a system paste. */
  paste(mode?: PasteMode): void;
}

const controllers = new WeakMap<ClipboardServices['entry'], ClipboardController>();

/** The controller `installClipboard` made; undefined before it ran and after its cleanup. */
export function clipboardController(
  entry: ClipboardServices['entry'],
): ClipboardController | undefined {
  return controllers.get(entry);
}

export interface ClipboardOptions {
  target?: Pick<Document, 'addEventListener' | 'removeEventListener'>;
  /** Raises the copy or cut event; `document.execCommand` by default. */
  exec?: (command: 'copy' | 'cut') => boolean;
}

const execDefault = (command: 'copy' | 'cut'): boolean => {
  const doc = globalThis.document;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way for a page to raise its own copy or cut event
  return typeof doc.execCommand === 'function' && doc.execCommand(command);
};

/** A text selection somewhere on the page: the user means to copy that, not notes. */
const hasTextSelection = (): boolean => {
  const selection = globalThis.getSelection();
  return selection !== null && !selection.isCollapsed;
};

/**
 * Copy, cut and paste of notes through the DOM clipboard events, which the keyboard raises in the
 * browser and the native menu's roles raise in Electron, with the clip on `text/plain` as a
 * versioned line plus JSON, so it travels to another window or Reprise build. The events are
 * left to the browser (nothing is prevented) when: another handler took them, a text field or an
 * open modal has them (the #226 rules), edit mode is off, or, for copy and cut, text is
 * selected. A palette Copy or Cut raises the event itself and is let through those last checks
 * once (`armed`), since the palette is still closing around it.
 */
export function installClipboard(
  services: ClipboardServices,
  options: ClipboardOptions = {},
): () => void {
  const target = options.target ?? globalThis.document;
  const exec = options.exec ?? execDefault;
  const { entry } = services;
  // Set around a palette Copy or Cut; the handler that honours it, or the fallback, clears it.
  const arm = { on: false };
  const armed = (): boolean => arm.on;
  const disarm = (): void => {
    arm.on = false;
  };

  const stands = (event: Event): boolean => {
    if (event.defaultPrevented || !services.editing.getState().editing) return false;
    if (armed()) return true;
    if (isTextField(event.target) || isTextField(globalThis.document.activeElement)) return false;
    return !modalBlocksCommand(`editor.${event.type}`);
  };

  // The text this handler last put on the system clipboard, and whether a palette fallback has
  // copied something newer since: then that text is stale, and a paste takes the internal clip.
  let written: string | undefined;
  let fallbackNewer = false;

  /** Puts the clip on the system clipboard and takes the event; a refused copy leaves both alone. */
  const publish = (event: ClipboardEvent, clip: Clip | undefined) => {
    if (!clip) return;
    const text = serializeClip(clip);
    event.preventDefault();
    event.clipboardData?.setData('text/plain', text);
    written = text;
    fallbackNewer = false;
  };

  const onCopy = (event: ClipboardEvent) => {
    if (!stands(event) || (!armed() && hasTextSelection())) return;
    disarm();
    publish(event, copySelection(services));
  };

  const onCut = (event: ClipboardEvent) => {
    if (!stands(event) || (!armed() && hasTextSelection())) return;
    disarm();
    publish(event, cutSelection(services));
  };

  const onPaste = (event: ClipboardEvent) => {
    if (!stands(event)) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    const clip = parseClip(text);
    if (clip && fallbackNewer && text === written) {
      pasteInternal(services);
    } else if (clip) {
      pasteClip(services, clip, entry.getState().mode);
    } else if (text.trim() === '') {
      pasteInternal(services);
    } else {
      entry.getState().setMessage('The clipboard holds no notes', 'notice');
    }
  };

  const raise = (command: 'copy' | 'cut', fallback: () => unknown) => {
    arm.on = true;
    exec(command);
    // No event came (a browser that refuses, or no gesture): do it on the internal clipboard,
    // which is now newer than whatever the system clipboard holds.
    if (armed()) {
      disarm();
      fallback();
      fallbackNewer = true;
    }
  };

  controllers.set(entry, {
    copy: () => {
      raise('copy', () => copySelection(services));
    },
    cut: () => {
      raise('cut', () => cutSelection(services));
    },
    paste: (mode) => {
      pasteInternal(services, mode);
    },
  });
  target.addEventListener('copy', onCopy);
  target.addEventListener('cut', onCut);
  target.addEventListener('paste', onPaste);
  return () => {
    target.removeEventListener('copy', onCopy);
    target.removeEventListener('cut', onCut);
    target.removeEventListener('paste', onPaste);
    controllers.delete(entry);
  };
}
