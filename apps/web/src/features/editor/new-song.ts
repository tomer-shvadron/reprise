import { createEmptyScore } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { whenSaved } from '@/app/when-saved';
import { applyNotationDefaults } from '@/state/notation-defaults';
import { notationDefaultsOf } from '@/state/notation-defaults-setting';

export type NewSongServices = Pick<AppServices, 'document' | 'ui' | 'editing' | 'settings'>;

/** Opens the empty song and turns edit mode on, after the switch that turns it off. */
export function createNewSong(services: NewSongServices): void {
  const { document, ui, editing, settings } = services;
  const score = createEmptyScore();
  document.getState().newDocument(
    applyNotationDefaults(
      score,
      score.tracks.map((track) => track.id),
      notationDefaultsOf(settings),
    ),
  );
  ui.getState().closeSheet();
  editing.getState().setEditing(true);
}

/** File > New Song: asks first when the open document has unsaved changes. */
export function startNewSong(services: NewSongServices): void {
  whenSaved(services, 'starting a new song', () => {
    createNewSong(services);
  });
}
