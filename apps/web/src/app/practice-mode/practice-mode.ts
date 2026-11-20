import type { AppServices } from '../services';

type Deps = Pick<AppServices, 'ui' | 'editing' | 'document'>;

/**
 * Hides the chrome and leaves Edit if it was on; `installPracticeMode` brings Edit back on leaving.
 * Does nothing without a score, so the mode never shows an empty window.
 */
export function enterPracticeMode({ ui, editing, document }: Deps): void {
  if (document.getState().score === undefined || ui.getState().practiceMode.on) return;
  const returnTo = editing.getState().editing ? 'edit' : 'play';
  editing.getState().setEditing(false);
  ui.getState().enterPracticeMode(returnTo);
}

/**
 * Brings the chrome back. Restoring Edit, the focus and the announcement happen in
 * `installPracticeMode`, so every way out (a command that shows a panel, the document closing)
 * behaves the same.
 */
export function leavePracticeMode({ ui }: Pick<AppServices, 'ui'>): void {
  ui.getState().leavePracticeMode();
}

export function togglePracticeMode(services: Deps): void {
  if (services.ui.getState().practiceMode.on) leavePracticeMode(services);
  else enterPracticeMode(services);
}
