import type { Range } from '@reprise/layout';

import { createDefaultSounds, createSoundPackStore, type SoundPackStore } from '@/features/sounds';
import { createPrintStore, viewLayoutOptions, type PrintStore } from '@/features/score';
// Not the feature's index: it re-exports the bar, whose services context imports this file.
import { installTransport } from '@/features/transport/install-transport';
import { createTransportUi, type TransportUiStore } from '@/features/transport/transport-ui';
import type { Platform } from '@/platform/platform';
import { read as readScore } from '@reprise/formats';
import {
  createDocumentStore,
  visibleTrackIds,
  type DocumentStore,
  type DocumentStoreDeps,
} from '@/state/document';
import { installClipboard } from '@/features/editor/clipboard-events';
import { installEntry } from '@/features/editor/entry-controller';
import { createEntryStore, type EntryStore } from '@/features/editor/entry-store';
import { installEditor } from '@/features/editor/install-editor';
import { createEditingStore, type EditingStore } from '@/state/editing';
import { createHeardRef, type HeardRef } from '@/state/heard';
import { createMenuTargetStore, type MenuTargetStore } from '@/state/menu-target';
import { createLayoutStore, type LayoutStore } from '@/state/layout';
import { createPlaybackStore, type PlaybackStore } from '@/state/playback';
import { createPracticeStore, type PracticeStore } from '@/state/practice';
import { createSelectionStore, type SelectionStore } from '@/state/selection';
import { applyNotationDefaults } from '@/state/notation-defaults';
import { notationDefaultsOf } from '@/state/notation-defaults-setting';
import { CHORD_DIAGRAMS_SETTING, CHORD_STRIP_SETTING } from '@/state/app-settings';
import { createSettingsStore, type SettingsStore } from '@/state/settings';
import type { DefaultSounds } from '@/state/sound-packs';
import { createUiStore, type UiStore } from '@/state/ui';

import { createContextMenuStore, type ContextMenuStore } from './context-menu/context-menu-store';
import { createAudioService, type AudioService } from './audio/audio-service';

export interface AppServices {
  platform: Platform;
  ui: UiStore;
  document: DocumentStore;
  selection: SelectionStore;
  playback: PlaybackStore;
  layout: LayoutStore;
  audio: AudioService;
  /** The installed sound packs, which the audio service reads (WP-091). */
  sounds: SoundPackStore;
  /** The transport bar's UI state, reachable from its commands. */
  transport: TransportUiStore;
  /** Where the drawn playhead is, so clicks and steps decide from what the user sees. */
  heard: HeardRef;
  /** The print dialog and the job it mounts. */
  print: PrintStore;
  /** The edit-mode flag (WP-080 onward). */
  editing: EditingStore;
  /** Note entry's session state: current rhythm, insert or overwrite, the waiting digit (WP-081). */
  entry: EntryStore;
  /** The running practice session (WP-070, WP-073). */
  practice: PracticeStore;
  /** The persisted preferences (#343); the app attaches the Dexie table once the library opens. */
  settings: SettingsStore;
  /** What the open context menu acts on (#337). */
  menuTarget: MenuTargetStore;
  /** The open context menu and where it sits; the host in `App` shows it. */
  contextMenu: ContextMenuStore;
  /**
   * What the mounted score view reports on demand (#421). Read when something asks, never pushed,
   * so scrolling renders nothing. Empty while no view is mounted.
   */
  viewProbe: ScoreViewProbe;
  dispose(): void;
}

export interface ScoreViewProbe {
  /** The master-bar index at the top of what is on screen; undefined with no view mounted. */
  barInView(): number | undefined;
  /** The mounted view registers how to read it, and clears it on unmount. */
  attach(read: () => number | undefined): () => void;
  /**
   * The segments mounted now (indices into the shown layout's systems): what an edit's layout
   * redraws at once (#229). Undefined with no view mounted.
   */
  mountedSystems(): Range | undefined;
  /** The mounted view registers how to read its mounted range, and clears it on unmount. */
  attachMounted(read: () => Range | undefined): () => void;
}

function createViewProbe(): ScoreViewProbe {
  let read: (() => number | undefined) | undefined;
  let readMounted: (() => Range | undefined) | undefined;
  return {
    barInView: () => read?.(),
    mountedSystems: () => readMounted?.(),
    attachMounted(next) {
      readMounted = next;
      return () => {
        if (readMounted === next) readMounted = undefined;
      };
    },
    attach(next) {
      read = next;
      // Clears only its own reader, so a second view unmounting cannot blank the live one.
      return () => {
        if (read === next) read = undefined;
      };
    },
  };
}

export interface AppServicesOptions {
  platform: Platform;
  ui?: UiStore;
  audio?: (
    playback: PlaybackStore,
    sounds: SoundPackStore,
    defaults: DefaultSounds,
  ) => AudioService;
  read?: DocumentStoreDeps['read'];
  write?: DocumentStoreDeps['write'];
  /** The preferences store; a fresh one, not yet attached to a backend, by default. */
  settings?: SettingsStore;
}

/** Every store and the audio service, created once outside React and wired to each other. */
export function createAppServices(options: AppServicesOptions): AppServices {
  const { platform } = options;
  const ui = options.ui ?? createUiStore();
  const settings = options.settings ?? createSettingsStore();
  // The file's own notation wins; the default fills what it left out. It waits for the stored
  // settings so a file opened at startup does not take the default over the user's choice.
  const readFile = options.read ?? readScore;
  const read: DocumentStoreDeps['read'] = async (bytes, readOptions) => {
    const [result] = await Promise.all([readFile(bytes, readOptions), settings.whenHydrated()]);
    return {
      ...result,
      score: applyNotationDefaults(
        result.score,
        result.implicitNotation,
        notationDefaultsOf(settings),
      ),
    };
  };
  const document = createDocumentStore({
    platform,
    read,
    ...(options.write && { write: options.write }),
  });
  const selection = createSelectionStore();
  const playback = createPlaybackStore();
  // The settings the layout depends on. `layoutSettings` reads them and the store re-lays out when
  // any of `LAYOUT_SETTINGS` changes, so a new one is added to both.
  const LAYOUT_SETTINGS = [CHORD_DIAGRAMS_SETTING];
  const layoutSettings = () => ({ chordDiagrams: settings.get(CHORD_DIAGRAMS_SETTING) });
  const viewProbe = createViewProbe();
  const layout = createLayoutStore({
    document,
    ui,
    visible: () => viewProbe.mountedSystems(),
    options: (view, content) =>
      viewLayoutOptions(view, {
        tracks: visibleTrackIds(content, document.getState().score),
        notation: content.notation,
        ...layoutSettings(),
      }),
    watch: (rerun) => {
      const stops = LAYOUT_SETTINGS.map((def) => settings.subscribe(def, rerun));
      return () => {
        for (const stop of stops) stop();
      };
    },
  });
  const sounds = createSoundPackStore({ platform, audio: () => audio });
  const defaults = createDefaultSounds(settings);
  const audio = (
    options.audio ??
    ((store, packs, family) => createAudioService({ playback: store, packs, defaults: family }))
  )(playback, sounds, defaults);

  const transport = createTransportUi();
  const editing = createEditingStore();
  const practice = createPracticeStore();
  const entry = createEntryStore();
  const menuTarget = createMenuTargetStore();

  const unsubscribe = document.subscribe((state, previous) => {
    if (state.id === previous.id && state.score === previous.score) return;
    const { id, score } = state;
    audio.setDocument(id !== undefined && score ? { id, score } : undefined);
    if (state.id !== previous.id) {
      ui.getState().setChordHighlight(undefined);
      selection.getState().reset(score?.tracks[0]?.id);
      // A document starts in play mode. The practice session is not ended here: WP-073 stores it
      // first, and `start` replaces a session of another document.
      editing.getState().setEditing(false);
      return;
    }
    const { currentTrack } = selection.getState();
    if (score && !score.tracks.some((track) => track.id === currentTrack)) {
      selection.getState().setCurrentTrack(score.tracks[0]?.id);
    }
  });

  // A pick in the chord strip belongs to the track it was made on; the strip shows the current one.
  const unsubscribeChordPick = selection.subscribe((state, previous) => {
    if (state.currentTrack !== previous.currentTrack) ui.getState().setChordHighlight(undefined);
  });

  // After the document wiring above, so a new document has reset the selection before the editor
  // reconciles its cursor with an edit.
  const uninstallEditor = installEditor({ document, selection, editing, playback });
  // After the editor, so its cursor reconcile has run before an entry lands the cursor.
  const uninstallEntry = installEntry({
    document,
    selection,
    editing,
    entry,
    preview: (trackId, note, options) => {
      audio.previewNote(trackId, note, options);
    },
  });

  // The clipboard events of edit mode; after the editor, whose reconcile an edit's range follows.
  const uninstallClipboard = installClipboard({
    document,
    selection,
    editing,
    entry,
    menuTarget,
    transport,
  });

  // After the document wiring above, so a switch reaches the audio service before the speed reset.
  const uninstallTransport = installTransport({
    audio,
    playback,
    document,
    selection,
    transport,
    settings,
    installJob: sounds.api,
  });

  return {
    platform,
    ui,
    document,
    selection,
    playback,
    layout,
    audio,
    sounds,
    transport,
    heard: createHeardRef(),
    print: createPrintStore({
      document,
      ui,
      platform,
      chordDiagrams: () => settings.get(CHORD_DIAGRAMS_SETTING),
      chordStrip: () => settings.get(CHORD_STRIP_SETTING),
      currentTrack: () => selection.getState().currentTrack,
    }),
    editing,
    entry,
    practice,
    settings,
    menuTarget,
    contextMenu: createContextMenuStore({ menuTarget }),
    viewProbe,
    dispose() {
      unsubscribeChordPick();
      uninstallClipboard();
      uninstallEntry();
      uninstallEditor();
      uninstallTransport();
      unsubscribe();
      layout.dispose();
      audio.dispose();
    },
  };
}
