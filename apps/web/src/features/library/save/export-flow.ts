import { write as writeScore, type Warning } from '@reprise/formats';
import { create } from 'zustand';

import { GP_FILES, withViewNotation, type DocumentStore } from '@/state/document';
import type { Platform } from '@/platform/platform';

import type { SongsRepository } from '../db/repository';
import type { SongRow } from '../db/rows';
import { safeName } from '../import/safe-name';

/** What the export dialog shows while it waits for the user. */
export interface ExportPrompt {
  fileName: string;
  /** What the Guitar Pro writer cannot hold of this score; never what an earlier import dropped. */
  dropped: readonly Warning[];
  /** Only a library song has a row to remember the choice on. */
  canRemember: boolean;
}

export type ExportAnswer = { choice: 'export'; remember: boolean } | { choice: 'cancel' };

export interface ExportPromptState {
  prompt: ExportPrompt | undefined;
  answer: ((answer: ExportAnswer) => void) | undefined;
}

export function createExportPromptStore() {
  return create<ExportPromptState>()(() => ({ prompt: undefined, answer: undefined }));
}
export type ExportPromptStore = ReturnType<typeof createExportPromptStore>;

export interface ExportFlowDeps {
  document: DocumentStore;
  platform: Pick<Platform, 'saveFile'>;
  repo: SongsRepository;
  promptStore: ExportPromptStore;
  onUpdated(row: SongRow): void;
  notify(message: string, kind?: 'error'): void;
  write?: typeof writeScore;
}

/** The warning codes, once each, in the order the writer gave them. */
export function codesOf(dropped: readonly Warning[]): string[] {
  return [...new Set(dropped.map((warning) => warning.code))];
}

/** Whether every kind of loss is one the user already accepted for this song; no loss is. */
export function allAcknowledged(dropped: readonly Warning[], acknowledged: readonly string[]) {
  return codesOf(dropped).every((code) => acknowledged.includes(code));
}

/**
 * File > Export as Guitar Pro. Writes `.gp` of the score as shown, to a place the user picks. It
 * is not a save: `dirty`, the file, its handle and `songId` never change. The dialog lists only
 * what the writer drops; a library song can remember the codes it was shown, and a kind of loss
 * not remembered asks again.
 */
export function createExporter(deps: ExportFlowDeps): () => Promise<void> {
  const { document, platform, repo, promptStore, write = writeScore } = deps;
  let running = false;

  const ask = (prompt: ExportPrompt) =>
    new Promise<ExportAnswer>((resolve) => {
      promptStore.setState({
        prompt,
        answer: (answer) => {
          promptStore.setState({ prompt: undefined, answer: undefined });
          resolve(answer);
        },
      });
    });

  return async () => {
    const { score, view, file, songId } = document.getState();
    if (!score || running) return;
    running = true;
    const base = score.meta.title.trim() || (file ? file.name.replace(/\.[^.]*$/, '') : '');
    const name = `${safeName(base === '' ? 'Untitled' : base)}.gp`;
    try {
      const { bytes, dropped } = await write(withViewNotation(score, view.notation), 'gp');
      const row = songId === undefined ? undefined : await repo.get(songId);
      const acknowledged = row?.exportAcknowledged ?? [];
      let remember: { row: SongRow; codes: string[] } | undefined;
      if (dropped.length > 0 && !allAcknowledged(dropped, acknowledged)) {
        const answer = await ask({ fileName: name, dropped, canRemember: row !== undefined });
        if (answer.choice === 'cancel') return;
        remember = answer.remember && row ? { row, codes: codesOf(dropped) } : undefined;
      }
      // A cancelled picker and a browser download both resolve with no path.
      const path = await platform.saveFile(name, bytes, GP_FILES);
      // "Don't warn again" is kept only once something was exported: a cancelled picker means the
      // user has not yet accepted losing anything, so the next export asks again.
      if (path !== undefined && remember) {
        const next = [...new Set([...(remember.row.exportAcknowledged ?? []), ...remember.codes])];
        try {
          if (await repo.update(remember.row.id, { exportAcknowledged: next })) {
            deps.onUpdated({ ...remember.row, exportAcknowledged: next });
          }
        } catch (error) {
          console.warn('Could not remember the export choice', error);
        }
      }
    } catch (error) {
      deps.notify(
        `Could not export ${name}: ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
    } finally {
      running = false;
    }
  };
}
