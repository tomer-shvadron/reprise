import { createEmptyScore } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { whenSaved } from '@/app/when-saved';

export type NewSongServices = Pick<AppServices, 'document' | 'ui' | 'editing'>;

/** Opens the empty song and turns edit mode on, after the switch that turns it off. */
export function createNewSong(services: NewSongServices): void {
  const { document, ui, editing } = services;
  document.getState().newDocument(createEmptyScore());
  ui.getState().setScreen('player');
  editing.getState().setEditing(true);
}

/** File > New Song: asks first when the open document has unsaved changes. */
export function startNewSong(services: NewSongServices): void {
  whenSaved(services, 'starting a new song', () => {
    createNewSong(services);
  });
}
