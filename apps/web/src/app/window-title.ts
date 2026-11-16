import type { Platform } from '@/platform/platform';
import type { DocumentState, DocumentStore } from '@/state/document';

export const APP_NAME = 'Reprise';

/** The title typed in the score, else the file's name without its extension, else Untitled. */
export function documentNameOf(state: Pick<DocumentState, 'score' | 'file'>): string {
  const title = state.score?.meta.title.trim();
  if (title) return title;
  const file = state.file?.name;
  if (file) {
    const dot = file.lastIndexOf('.');
    const stem = dot > 0 ? file.slice(0, dot) : file;
    if (stem.trim() !== '') return stem;
  }
  return 'Untitled';
}

/** `● name — Reprise` while modified, `name — Reprise` when clean, `Reprise` with nothing open. */
export function windowTitleOf(
  state: Pick<DocumentState, 'id' | 'score' | 'file' | 'dirty'>,
): string {
  if (state.id === undefined || !state.score) return APP_NAME;
  return `${state.dirty ? '● ' : ''}${documentNameOf(state)} — ${APP_NAME}`;
}

/**
 * Keeps the page title, which Electron's window follows, and the macOS edited dot in step with
 * the document. Returns the undo.
 */
export function installWindowTitle(
  document: DocumentStore,
  platform: Pick<Platform, 'setDocumentEdited'>,
  target: Pick<Document, 'title'> = globalThis.document,
): () => void {
  let title: string | undefined;
  let edited: boolean | undefined;
  const sync = (state: DocumentState) => {
    const next = windowTitleOf(state);
    if (next !== title) {
      title = next;
      target.title = next;
    }
    const nowEdited = state.id !== undefined && state.dirty;
    if (nowEdited !== edited) {
      edited = nowEdited;
      platform.setDocumentEdited?.(nowEdited);
    }
  };
  sync(document.getState());
  return document.subscribe(sync);
}
