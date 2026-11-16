/**
 * Whether closing a window needs the renderer's say first. The renderer reports whether the
 * document is edited; while it is, a close (the window's button, or Quit) is held and the renderer
 * is asked, and the window closes only when the renderer answers `window:close`. Everything that
 * could leave the question unanswered lets the close through, so a dead page never traps the app.
 */
export interface CloseGuardState {
  /** The renderer last reported unsaved changes. */
  edited: boolean;
  /** The renderer process crashed or was killed: nobody is there to ask. */
  rendererGone: boolean;
  /** The renderer stopped responding: the question would never be read. */
  unresponsive: boolean;
  /** The window is already being torn down. */
  destroyed: boolean;
  /** The renderer already answered, so the close it asked for may go through. */
  confirmed: boolean;
}

export type CloseAction = 'allow' | 'ask';

export function closeAction(state: CloseGuardState): CloseAction {
  if (state.confirmed || state.destroyed || state.rendererGone || state.unresponsive) {
    return 'allow';
  }
  return state.edited ? 'ask' : 'allow';
}

export interface CloseGuardPorts {
  /** Sends `window:close-requested` to the renderer. */
  ask(): void;
  /** Closes the window; it comes back through `onClose`, which lets it pass. */
  closeWindow(): void;
  /** Quits the app, for a close that began as Quit. */
  quitApp(): void;
}

/**
 * One window's guard. Each hook returns true when the caller must `preventDefault` the event it
 * is handling. A request the renderer never answered is asked again by the next attempt, so the
 * renderer must treat a second request while its dialog is open as a no-op.
 */
export class CloseGuard {
  readonly #ports: CloseGuardPorts;
  #edited = false;
  #rendererGone = false;
  #unresponsive = false;
  #destroyed = false;
  #confirmed = false;
  #asking = false;
  #quitting = false;

  constructor(ports: CloseGuardPorts) {
    this.#ports = ports;
  }

  setEdited(edited: boolean): void {
    this.#edited = edited;
    // A document that was edited and is now clean no longer owes anyone a question.
    if (!edited) this.#end();
  }

  // A crash or a hang only lets the next close or Quit through unasked. It never finishes a
  // request already open: a transient hang minutes after a Cancel must not quit the app.
  markRendererGone(): void {
    this.#rendererGone = true;
  }

  markUnresponsive(unresponsive: boolean): void {
    this.#unresponsive = unresponsive;
  }

  /** A new page loaded in the window: it has reported nothing, and a dead renderer is replaced. */
  reset(): void {
    this.#edited = false;
    this.#rendererGone = false;
    this.#unresponsive = false;
    this.#confirmed = false;
    this.#asking = false;
    this.#quitting = false;
  }

  markDestroyed(): void {
    this.#destroyed = true;
    this.#end();
  }

  /** The window's `close` event. */
  onClose(): boolean {
    this.#quitting = false;
    return this.#request();
  }

  /** The app's `before-quit` event. */
  onBeforeQuit(): boolean {
    const hold = this.#request();
    if (hold) this.#quitting = true;
    return hold;
  }

  /**
   * The renderer's `window:close`: `true` after it saved or discarded, `false` for Cancel. Either
   * ends the request; ignored when none is open, so a page cannot close the window at will.
   */
  answer(close: boolean): void {
    if (!this.#asking) return;
    if (!close) {
      this.#end();
      return;
    }
    this.#asking = false;
    this.#confirmed = true;
    this.#finish();
  }

  #request(): boolean {
    const action = closeAction({
      edited: this.#edited,
      rendererGone: this.#rendererGone,
      unresponsive: this.#unresponsive,
      destroyed: this.#destroyed,
      confirmed: this.#confirmed,
    });
    if (action === 'allow') return false;
    this.#asking = true;
    this.#ports.ask();
    return true;
  }

  #end(): void {
    this.#asking = false;
    this.#quitting = false;
  }

  #finish(): void {
    const quit = this.#quitting;
    this.#quitting = false;
    this.#ports.closeWindow();
    if (quit) this.#ports.quitApp();
  }
}
