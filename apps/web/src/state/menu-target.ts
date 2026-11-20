import type { Id } from '@reprise/model';
import { create } from 'zustand';

import type { PanelView } from './ui';

/** The header's regions, each with its own menu; `band` is the bar itself. */
export type HeaderElement = 'crumb' | 'mode' | 'view' | 'search' | 'band';

/**
 * What a context menu was opened on: ids and names only, never the data itself. A command reads
 * it through a helper and falls back to the selection, the cursor or the current track, so the
 * same command works from the palette, its keys and the menu.
 */
export type MenuTarget =
  | { kind: 'note'; note: Id; beat: Id; track: Id; masterBar: Id }
  | { kind: 'beat'; beat: Id; track: Id; masterBar: Id }
  | { kind: 'bar'; masterBar: Id; track: Id | undefined }
  /** `bar` is the bar clicked inside the range, which "Play from here" starts at. */
  | { kind: 'range'; bar?: Id }
  | { kind: 'chord'; beat: Id; track: Id; masterBar: Id }
  | { kind: 'section'; masterBar: Id }
  | { kind: 'paper' }
  | { kind: 'track'; track: Id }
  | { kind: 'mixerMaster' }
  | { kind: 'transport'; control: 'loop' | 'tempo' | 'countIn' | 'metronome' }
  /** `view` is undefined on the rail's fold button. */
  | { kind: 'panel'; view: PanelView | undefined }
  | { kind: 'dock'; view: 'fretboard' }
  | { kind: 'header'; element: HeaderElement }
  | { kind: 'status'; segment: string }
  | { kind: 'libraryEntry'; id: string }
  | { kind: 'soundPack'; id: string; state: 'installed' | 'available' | 'damaged' };

export interface MenuTargetState {
  target: MenuTarget | undefined;
  set(target: MenuTarget): void;
  clear(): void;
}

/**
 * What the open context menu acts on; set when the menu opens, cleared when the menu closes, with
 * its command run first when one was chosen. The host clears it as soon as `run` returns, which
 * is after the synchronous part of an async command only: such a command reads the target before
 * its first `await`.
 */
export function createMenuTargetStore() {
  return create<MenuTargetState>()((set) => ({
    target: undefined,
    set(target) {
      set({ target });
    },
    clear() {
      set({ target: undefined });
    },
  }));
}

export type MenuTargetStore = ReturnType<typeof createMenuTargetStore>;
