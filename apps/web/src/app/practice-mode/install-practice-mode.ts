import { PRACTICE_ZOOM_SETTING } from '@/state/app-settings';
import type { AppServices } from '../services';

type Deps = Pick<AppServices, 'ui' | 'editing' | 'document' | 'settings' | 'transport'>;

const scoreRegion = () =>
  globalThis.document.querySelector<HTMLElement>('[role="region"][aria-roledescription="score"]') ??
  globalThis.document.querySelector<HTMLElement>('main');

/**
 * Everything the practice mode does besides hiding the chrome, in one place so that every way in
 * and out behaves alike:
 * - the practice zoom is kept in its setting, like the right panel's width;
 * - turning Edit on leaves the mode (⌘E, the Edit segment);
 * - closing the document leaves it, and opening another resets where Escape returns to;
 * - entering moves focus off the chrome that is about to go, leaving restores Edit and focus, and
 *   both announce.
 * It never writes a panel or dock setting: the mode changes none of that state.
 */
export function installPracticeMode(deps: Deps): () => void {
  const { ui, editing, document, settings, transport } = deps;

  const applyZoom = () => {
    ui.getState().setPracticeZoom(settings.get(PRACTICE_ZOOM_SETTING));
  };
  // Only a stored value is applied; a change made before the load wins over the stored row.
  if (settings.isStored(PRACTICE_ZOOM_SETTING)) applyZoom();
  const stopSetting = settings.subscribe(PRACTICE_ZOOM_SETTING, applyZoom);

  let focusBefore: Element | null = null;
  let frame: number | undefined;
  const afterCommit = (task: () => void) => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      task();
    });
  };

  const stopUi = ui.subscribe((state, previous) => {
    if (state.practiceZoom !== previous.practiceZoom) {
      const zoom = state.practiceZoom;
      if (!settings.hydrated() || zoom !== settings.get(PRACTICE_ZOOM_SETTING)) {
        settings.set(PRACTICE_ZOOM_SETTING, zoom);
      }
    }
    if (state.practiceMode.on === previous.practiceMode.on) return;
    if (state.practiceMode.on) {
      focusBefore = globalThis.document.activeElement;
      // The header, panels and footer unmount, taking any focus inside them to the body.
      afterCommit(() => {
        const active = globalThis.document.activeElement;
        if (!active || active === globalThis.document.body || !active.isConnected) {
          scoreRegion()?.focus({ preventScroll: true });
        }
      });
      transport.getState().announce('Practice mode. Escape leaves.');
      return;
    }
    const back = state.practiceMode.returnTo;
    if (back === 'edit' && document.getState().score && !editing.getState().editing) {
      editing.getState().setEditing(true);
    }
    const noted = focusBefore;
    focusBefore = null;
    afterCommit(() => {
      if (noted instanceof HTMLElement && noted.isConnected && noted !== globalThis.document.body) {
        noted.focus({ preventScroll: true });
      }
    });
    transport.getState().announce('Practice mode off.');
  });

  const stopEditing = editing.subscribe((state, previous) => {
    if (state.editing && !previous.editing) ui.getState().leavePracticeMode();
  });

  const stopDocument = document.subscribe((state, previous) => {
    if (state.score === undefined && previous.score !== undefined) {
      ui.getState().leavePracticeMode();
    }
    // An open resets edit mode, so Escape has nothing to restore.
    if (state.id !== previous.id && ui.getState().practiceMode.returnTo !== 'play') {
      ui.setState((current) => ({ practiceMode: { ...current.practiceMode, returnTo: 'play' } }));
    }
  });

  return () => {
    stopSetting();
    stopUi();
    stopEditing();
    stopDocument();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
