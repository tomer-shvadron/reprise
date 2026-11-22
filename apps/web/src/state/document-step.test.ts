import { layout } from '@reprise/layout';
import { setNote } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { installEditor } from '@/features/editor/install-editor';
import { viewLayoutOptions } from '@/features/score';
import { fakePlatform } from '@/test/services';

import { createDocumentStore } from './document';
import { createEditingStore } from './editing';
import { installHistoryMenu } from './history-menu';
import { createLayoutStore } from './layout';
import { createPlaybackStore } from './playback';
import { createSelectionStore } from './selection';
import { createUiStore } from './ui';

const TRACKS = 8;
const BARS = 300;
const EDITS = 100;
// Measured on the reference machine (M4 Pro), the jump alone: step(-100) 25 ms and step(100) 18 ms,
// and 26 ms at worst under three parallel runs. The 100-call undo and redo loop it replaces took
// 353 and 247 ms with the same subscribers. The bound is 10x the alone figure (250 ms), which is
// also 10x the parallel worst (260 ms), rounded up on the 1-2-5 series; it cannot tell the loop
// from the new code, the single-publish assertions do. The whole test took about 1.5 s alone and
// 1.5 s at worst under three parallel runs, so the timeout below is the 30 s floor.
const JUMP_BOUND_MS = 500;

describe('a long history jump', () => {
  it(
    `replays ${String(EDITS)} steps with one publish, inside a sanity bound`,
    { timeout: 30_000 },
    () => {
      const platform = fakePlatform({ setHistoryLabels: vi.fn() });
      const document = createDocumentStore({ platform });
      const opened = largeScore(TRACKS, BARS);
      document.getState().newDocument(opened);
      // Before any subscriber exists, so the setup does not pay a layout per edit.
      for (let edit = 0; edit < EDITS; edit++) {
        const current = document.getState().score;
        const beat = current?.tracks[0]?.bars[edit % 25]?.voices[0].beats[0];
        const note = beat?.notes[0];
        if (!beat || !note) throw new Error('the long score lost a beat');
        document
          .getState()
          .apply(
            setNote(
              { beatId: beat.id },
              { string: note.string, fret: (note.fret + edit + 1) % 12 },
            ),
          );
      }
      const edited = document.getState().score;

      const ui = createUiStore('dark');
      layoutStoreFor(document, ui);
      const selection = createSelectionStore();
      const editing = createEditingStore();
      const playback = createPlaybackStore();
      installEditor({ document, selection, editing, playback });
      installHistoryMenu(document, platform);
      editing.getState().setEditing(true);
      const published = vi.fn();
      document.subscribe(published);

      const time = (run: () => void): number => {
        const start = performance.now();
        run();
        return performance.now() - start;
      };
      const back = time(() => {
        document.getState().step(-EDITS);
      });
      expect(document.getState().score).toEqual(opened);
      expect(published).toHaveBeenCalledTimes(1);
      const forward = time(() => {
        document.getState().step(EDITS);
      });
      expect(document.getState().score).toEqual(edited);
      expect(published).toHaveBeenCalledTimes(2);
      expect(back).toBeLessThan(JUMP_BOUND_MS);
      expect(forward).toBeLessThan(JUMP_BOUND_MS);
    },
  );
});

function layoutStoreFor(
  document: ReturnType<typeof createDocumentStore>,
  ui: ReturnType<typeof createUiStore>,
) {
  return createLayoutStore({ document, ui, options: viewLayoutOptions, layout });
}
