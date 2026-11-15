import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import { CommandRegistry } from '@/app/command-registry';
import { installShortcutDispatcher } from '@/app/shortcut-dispatcher';
import { detectKeyboardPlatform } from '@/app/keyboard';
import {
  createGestureTracker,
  ScoreView,
  uniformNotation,
  useScoreFonts,
  viewLayoutOptions,
  type NotationChoice,
  type ScorePointerEvent,
  type ScoreViewHandle,
} from '@/features/score';
import { createDocumentStore, visibleTrackIds } from '@/state/document';
import { createEditingStore } from '@/state/editing';
import { createLayoutStore } from '@/state/layout';
import { createPlaybackStore } from '@/state/playback';
import { createSelectionStore } from '@/state/selection';
import { createUiStore } from '@/state/ui';

import { createEditPointer } from '../edit-pointer';
import { caretRect } from '../geometry';
import { installEditor } from '../install-editor';
import { navigationCommands } from '../navigation-commands';
import { useEditOverlaysFor } from '../use-edit-overlays';

const refuse = () => Promise.reject(new Error('the edit demo has no files'));

/** The stores the editor works over, with no audio and no file system. */
async function createDemo(score: Score, mode: 'paged' | 'continuous', notation: NotationChoice) {
  const ui = createUiStore();
  ui.getState().setViewMode(mode);
  const document = createDocumentStore({
    platform: { openFile: () => Promise.resolve(undefined), saveFile: refuse, writeHandle: refuse },
  });
  const selection = createSelectionStore();
  const editing = createEditingStore();
  const playback = createPlaybackStore();
  const layout = createLayoutStore({
    document,
    ui,
    options: (view, content) =>
      viewLayoutOptions(view, {
        tracks: visibleTrackIds(content, document.getState().score),
        notation: content.notation,
      }),
  });
  // The same wiring as the app's services: a new document resets the selection.
  document.subscribe((state, previous) => {
    if (state.id !== previous.id) selection.getState().reset(state.score?.tracks[0]?.id);
  });
  installEditor({ document, selection, editing, playback });
  await document.getState().openBytes('edit-demo.reprise', (await write(score, 'reprise')).bytes);
  const opened = document.getState().score;
  if (opened) {
    for (const [id, choice] of Object.entries(uniformNotation(opened, notation))) {
      document.getState().setNotation(id, choice);
    }
  }
  editing.getState().setEditing(true);
  return { document, selection, editing, layout, playback };
}

type Demo = Awaited<ReturnType<typeof createDemo>>;

function Status({ demo }: { demo: Demo }) {
  const cursor = useStore(demo.selection, (state) => state.cursor);
  const range = useStore(demo.selection, (state) => state.range);
  const picked = useStore(demo.selection, (state) => state.selection.noteIds?.length ?? 0);
  const text = cursor
    ? `track ${String(cursor.at.track + 1)}, bar ${String(cursor.at.bar + 1)}, stop ${String(cursor.at.beat + 1)}, voice ${String(cursor.voice + 1)}, string ${String(cursor.string)} (${cursor.staff})`
    : 'no cursor';
  return (
    <p className="text-ink-muted px-4 py-2 text-sm" data-testid="edit-status">
      {text}
      {range ? `, ${range.kind} range` : ''}
      {picked > 0 ? `, ${String(picked)} notes picked` : ''}
    </p>
  );
}

function Stage({ demo }: { demo: Demo }) {
  const result = useStore(demo.layout, (state) => state.result);
  const cursor = useStore(demo.selection, (state) => state.cursor);
  const overlays = useEditOverlaysFor(demo);
  const [gestures] = useState(createGestureTracker);
  const pointer = useMemo(() => createEditPointer(demo), [demo]);
  const handle = useRef<ScoreViewHandle>(null);

  useEffect(() => {
    const rect = overlays.caret && caretRect(overlays.caret);
    if (rect) handle.current?.revealRect(rect);
    // Only a cursor move reveals; a range or layout change leaves the scroll alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the cursor on purpose
  }, [cursor]);

  if (!result) return null;
  const onScorePointer = (event: ScorePointerEvent) => {
    const gesture = gestures.handle(event, 'area');
    if (gesture) pointer(result, gesture);
  };
  return (
    <ScoreView
      ref={handle}
      layout={result}
      zoom={1}
      label="Edit demo score"
      overlays={overlays}
      onScorePointer={onScorePointer}
      className="h-full min-h-0 flex-1"
    />
  );
}

/**
 * The edit cursor and range over a score, with no app around it: click, drag, Shift and
 * Cmd/Ctrl+click, the arrows, Home and End, PageUp and PageDown, Shift-extend and Escape. It is
 * how WP-080's acceptance is checked by hand on the long score (`?edit=1` on the score demo).
 */
export function EditDemo({
  score,
  mode,
  notation,
}: {
  score: Score;
  mode: 'paged' | 'continuous';
  notation: NotationChoice;
}) {
  const fontsReady = useScoreFonts();
  const [demo, setDemo] = useState<Demo>();

  useEffect(() => {
    let off: (() => void) | undefined;
    let cancelled = false;
    void createDemo(score, mode, notation).then((created) => {
      if (cancelled) return;
      const registry = new CommandRegistry(() => true);
      for (const command of navigationCommands(created)) registry.register(command);
      off = installShortcutDispatcher(window, registry, detectKeyboardPlatform());
      setDemo(created);
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [score, mode, notation]);

  if (!fontsReady || !demo) return <p className="p-4">Loading…</p>;
  return (
    <div className="flex h-screen flex-col">
      <Status demo={demo} />
      <Stage demo={demo} />
    </div>
  );
}
