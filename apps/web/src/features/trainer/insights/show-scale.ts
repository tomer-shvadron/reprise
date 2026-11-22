import type { AppServices } from '@/app/services';
import type { ScaleId } from '@/lib/insights';

import { scaleOverlayFor } from '../fretboard/scale-overlay';

/**
 * Marks a scale on the fretboard and opens the dock, for the cards that show a scale other than
 * the song's (a section's, a track's). The song's own scale goes through its command, which waits
 * for the analysis and follows the score as it is edited.
 */
export function showScaleOnFretboard(
  services: Pick<AppServices, 'document' | 'ui'>,
  tonic: number,
  scaleId: ScaleId,
): void {
  services.ui.getState().showBottomPanelView('fretboard');
  scaleOverlayFor(services).getState().show(tonic, scaleId, 'section');
}
