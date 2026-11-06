import { create } from 'zustand';

export type TransportPopover = 'metronome' | 'master';

/** The transport bar's UI-only state, kept in a store so commands can reach it. */
export interface TransportUiState {
  popover: TransportPopover | undefined;
  /** A request to focus a control; a new `nonce` repeats it. */
  focus: { target: 'tempo'; nonce: number } | undefined;
  /** What the live region reads; a new `nonce` re-reads the same text. */
  announcement: { text: string; nonce: number } | undefined;
  /** The speed the relative-speed toggle returns to; set when it switches to 100%. */
  rememberedSpeed: number | undefined;
  setPopover(popover: TransportPopover | undefined): void;
  requestFocus(target: 'tempo'): void;
  announce(text: string): void;
  setRememberedSpeed(percent: number | undefined): void;
}

export function createTransportUi() {
  let nonce = 0;
  return create<TransportUiState>()((set) => ({
    popover: undefined,
    focus: undefined,
    announcement: undefined,
    rememberedSpeed: undefined,
    setPopover(popover) {
      set({ popover });
    },
    requestFocus(target) {
      nonce += 1;
      set({ focus: { target, nonce } });
    },
    announce(text) {
      nonce += 1;
      set({ announcement: { text, nonce } });
    },
    setRememberedSpeed(percent) {
      set({ rememberedSpeed: percent });
    },
  }));
}

export type TransportUiStore = ReturnType<typeof createTransportUi>;
