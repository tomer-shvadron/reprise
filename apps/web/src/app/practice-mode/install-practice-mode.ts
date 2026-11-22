import { PRACTICE_ZOOM_SETTING } from '@/state/app-settings';
import { scoreRegion } from '../score-region';
import type { AppServices } from '../services';

type Deps = Pick<AppServices, 'ui' | 'editing' | 'document' | 'settings' | 'transport'>;

/**
 * Where focus goes when the mode ends: the element that had it on entering, or, when it was
 * unmounted since, the one with the same role and label (the Practice radio, a mixer slider), or
 * the score. Nothing when focus was on the body, so a click entry and exit stay frameless.
 */
function restoreTarget(
  noted: Element | null,
  identity: { role: string | null; label: string } | undefined,
): HTMLElement | null {
  if (!noted || noted === globalThis.document.body) return null;
  if (noted instanceof HTMLElement && noted.isConnected) return noted;
  if (identity) {
    const match = [
      ...globalThis.document.querySelectorAll<HTMLElement>(
        `[aria-label="${CSS.escape(identity.label)}"]`,
      ),
    ].find((element) => element.getAttribute('role') === identity.role);
    if (match) return match;
  }
  return scoreRegion();
}

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
  // What to look for if the element is gone when the mode ends: the chrome remounts on leaving.
  let focusIdentity: { role: string | null; label: string } | undefined;
  let frame: number | undefined;
  const afterCommit = (task: () => void, frames = 1) => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    const step = (left: number) => {
      frame = requestAnimationFrame(() => {
        frame = undefined;
        if (left > 1) step(left - 1);
        else task();
      });
    };
    step(frames);
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
      const label = focusBefore?.getAttribute('aria-label');
      focusIdentity = label
        ? { role: focusBefore?.getAttribute('role') ?? null, label }
        : undefined;
      const before = focusBefore;
      // The header, panels and footer unmount, taking any focus inside them to the body.
      // Focus moves to the score only then: after a click on the Practice segment it sits on the
      // body already, and the region's focus ring would frame the whole window.
      afterCommit(() => {
        const active = globalThis.document.activeElement;
        const lost = !active || active === globalThis.document.body || !active.isConnected;
        if (lost && before && before !== globalThis.document.body) {
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
    const identity = focusIdentity;
    focusBefore = null;
    focusIdentity = undefined;
    // The panels remount and take focus on mount (`focusPanelSection`), so this runs a frame
    // later than the entry's restore and overrides them.
    afterCommit(() => {
      const target = restoreTarget(noted, identity);
      if (target) target.focus({ preventScroll: true });
    }, 2);
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
