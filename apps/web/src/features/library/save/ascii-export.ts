import { ASCII_TAB_WIDTH, writeAsciiTab, type Warning } from '@reprise/formats';
import { canShowTab, type Id, type Score } from '@reprise/model';
import { create } from 'zustand';

import { copyText } from '@/lib/system-clipboard';
import type { FileFilter, Platform } from '@/platform/platform';
import { visibleTrackIds, type DocumentStore } from '@/state/document';
import type { MenuTargetStore } from '@/state/menu-target';
import type { SelectionStore } from '@/state/selection';

import { safeName } from '../import/safe-name';
import { asciiScopeOf } from './ascii-scope';

export const TEXT_FILES: readonly FileFilter[] = [{ name: 'Text', extensions: ['txt'] }];

export interface AsciiTrackChoice {
  id: Id;
  name: string;
  /** False for a drum or pitched track: it has no strings, so the dialog greys it out. */
  fretted: boolean;
}

/** What the export dialog shows; the text of the width field is kept as typed. */
export interface AsciiDialog {
  choices: AsciiTrackChoice[];
  tracks: Id[];
  /** The selected bars as 1-based, inclusive numbers; undefined when nothing is selected. */
  selectedBars: { first: number; last: number } | undefined;
  barsMode: 'song' | 'selection';
  widthText: string;
  /** Why the writer refused, for the dialog to show. */
  error: string | undefined;
}

export interface AsciiDialogState {
  dialog: AsciiDialog | undefined;
}

export function createAsciiDialogStore() {
  return create<AsciiDialogState>()(() => ({ dialog: undefined }));
}
export type AsciiDialogStore = ReturnType<typeof createAsciiDialogStore>;

export interface AsciiExportDeps {
  document: DocumentStore;
  selection: SelectionStore;
  menuTarget: MenuTargetStore;
  platform: Pick<Platform, 'saveFile'>;
  notify: (message: string, kind?: 'error') => void;
}

export interface AsciiExporter {
  store: AsciiDialogStore;
  /** File > Export as ASCII tab: opens the dialog. */
  open(): void;
  update(change: Partial<Pick<AsciiDialog, 'tracks' | 'barsMode' | 'widthText'>>): void;
  cancel(): void;
  /** The dialog's Export: writes the file through the platform's save dialog. */
  submit(): Promise<void>;
  /** Copy as ASCII tab: the target's, or the selection's, tracks and bars, to the clipboard. */
  copy(): Promise<void>;
}

/** The width in the field, or undefined when it is not a whole number in the writer's range. */
export function parseWidth(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const width = Number(trimmed);
  return width >= ASCII_TAB_WIDTH.min && width <= ASCII_TAB_WIDTH.max ? width : undefined;
}

/**
 * What the text leaves out, as the sentence a notice appends: the writer's own messages, one per
 * kind of loss. The convention's usual absences (rhythm, dynamics) are not repeated here.
 */
export function leftOut(dropped: readonly Warning[]): string {
  return dropped.map((warning) => warning.message).join(' ');
}

const barCount = (bars: { start: number; end: number }) => bars.end - bars.start;

function fileNameOf(score: Score, fileName: string | undefined, tracks: readonly Id[]): string {
  const title =
    score.meta.title.trim() || (fileName ? fileName.replace(/\.[^.]*$/u, '') : '') || 'Untitled';
  const only =
    tracks.length === 1 ? score.tracks.find((track) => track.id === tracks[0]) : undefined;
  const track = only?.name.trim();
  return `${safeName(track ? `${title} - ${track}` : title)}.txt`;
}

/**
 * Export as ASCII tab and Copy as ASCII tab (#350). Neither is a save: `dirty`, the file and
 * `songId` never change. After either, a notice says what the text leaves out; there is no
 * confirmation, because the format always loses rhythm and dynamics.
 */
export function createAsciiExporter(deps: AsciiExportDeps): AsciiExporter {
  const { document, selection, menuTarget, platform, notify } = deps;
  const store = createAsciiDialogStore();
  // Remembered for the session, the way print remembers its settings; Copy uses it too.
  let width: number = ASCII_TAB_WIDTH.default;
  let running = false;

  const patch = (change: Partial<AsciiDialog>) => {
    store.setState((state) => (state.dialog ? { dialog: { ...state.dialog, ...change } } : state));
  };

  return {
    store,
    open() {
      const { score } = document.getState();
      if (!score) return;
      const shown = visibleTrackIds(document.getState().view, score);
      const choices = score.tracks
        .map((track, index) => ({ track, index }))
        .filter(({ track }) => shown === 'all' || shown.includes(track.id))
        .map(({ track, index }) => ({
          id: track.id,
          name: track.name.trim() || `Track ${String(index + 1)}`,
          fretted: canShowTab(track),
        }));
      const { currentTrack } = selection.getState();
      const initial =
        choices.find((choice) => choice.id === currentTrack && choice.fretted) ??
        choices.find((choice) => choice.fretted);
      const bars = asciiScopeOf(
        score,
        selection.getState(),
        undefined,
        document.getState().view,
      )?.bars;
      store.setState({
        dialog: {
          choices,
          tracks: initial ? [initial.id] : [],
          selectedBars: bars && { first: bars.start + 1, last: bars.end },
          barsMode: bars ? 'selection' : 'song',
          widthText: String(width),
          error: undefined,
        },
      });
    },
    update(change) {
      patch({ ...change, error: undefined });
    },
    cancel() {
      store.setState({ dialog: undefined });
    },
    async submit() {
      const { dialog } = store.getState();
      const { score, file } = document.getState();
      const parsed = dialog ? parseWidth(dialog.widthText) : undefined;
      if (!dialog || !score || parsed === undefined || dialog.tracks.length === 0 || running)
        return;
      const bars =
        dialog.barsMode === 'selection' && dialog.selectedBars
          ? { start: dialog.selectedBars.first - 1, end: dialog.selectedBars.last }
          : undefined;
      let result;
      try {
        result = writeAsciiTab(score, {
          tracks: dialog.tracks,
          width: parsed,
          ...(bars && { bars }),
        });
      } catch (error) {
        patch({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
      width = parsed;
      store.setState({ dialog: undefined });
      running = true;
      const name = fileNameOf(score, file?.name, dialog.tracks);
      try {
        const path = await platform.saveFile(
          name,
          new TextEncoder().encode(result.text),
          TEXT_FILES,
        );
        // A cancelled picker, and the download fallback of a browser with no save picker, both
        // resolve with no path: nothing to report.
        if (path !== undefined) {
          const left = leftOut(result.dropped);
          notify(`Exported ${name}.${left === '' ? '' : ` ${left}`}`);
        }
      } catch (error) {
        notify(
          `Could not export ${name}: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      } finally {
        running = false;
      }
    },
    async copy() {
      const { score } = document.getState();
      if (!score) return;
      // Before the first await: the host clears the menu target once `run` returns.
      const scope = asciiScopeOf(
        score,
        selection.getState(),
        menuTarget.getState().target,
        document.getState().view,
      );
      if (!scope) {
        notify('Select some bars to copy them as ASCII tab.', 'error');
        return;
      }
      try {
        const { text, dropped } = writeAsciiTab(score, { ...scope, width });
        await copyText(text);
        const bars = barCount(scope.bars);
        const left = leftOut(dropped);
        notify(
          `Copied ${String(bars)} ${bars === 1 ? 'bar' : 'bars'} as ASCII tab.${left === '' ? '' : ` ${left}`}`,
        );
      } catch (error) {
        notify(
          `Could not copy as ASCII tab: ${error instanceof Error ? error.message : String(error)}`,
          'error',
        );
      }
    },
  };
}
