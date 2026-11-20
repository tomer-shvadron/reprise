import type { UiStore } from '@/state/ui';

/**
 * Puts the next Tab on a panel view's first control when the view mounts, so a user who opens
 * the panel lands in it. Not for a panel restored at launch, which must not take focus from the
 * page, and not when the user got here with the arrow keys on the tab strip: moving focus out of
 * the tab would break the pattern.
 */
export function focusPanelSection(section: HTMLElement | null, ui: UiStore): void {
  if (ui.getState().panelRestored) return;
  if (document.activeElement?.closest('[role="tab"]')) return;
  section?.focus();
}
