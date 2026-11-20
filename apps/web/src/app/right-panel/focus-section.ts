/**
 * Puts the next Tab on a panel view's first control when the view mounts, unless the user got
 * here with the arrow keys on the tab strip: moving focus out of the tab would break the pattern.
 */
export function focusPanelSection(section: HTMLElement | null): void {
  if (document.activeElement?.closest('[role="tab"]')) return;
  section?.focus();
}
