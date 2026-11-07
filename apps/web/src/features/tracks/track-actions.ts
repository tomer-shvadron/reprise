import { setTrackProperties, type Id, type Notation, type Track } from '@reprise/model';
import { useMemo } from 'react';

import type { AppServices } from '@/app/services';
import { useAppServices } from '@/app/services-context';
import { singleTrackOf } from '@/state/document';

import { effectiveMix, nextVisibility, stepTrackId } from './track-model';

export type TrackServices = Pick<AppServices, 'document' | 'selection' | 'playback' | 'audio'>;

function trackOf(services: TrackServices, id: Id): Track | undefined {
  return services.document.getState().score?.tracks.find((track) => track.id === id);
}

/** Makes `id` current; in single-track view it is also the track shown. */
export function selectTrack(services: TrackServices, id: Id): void {
  const { document, selection } = services;
  selection.getState().setCurrentTrack(id);
  const { view, score } = document.getState();
  if (singleTrackOf(view, score) !== undefined) document.getState().setSingleTrack(id);
}

export function stepTrack(services: TrackServices, direction: -1 | 1): void {
  const tracks = services.document.getState().score?.tracks ?? [];
  const next = stepTrackId(tracks, services.selection.getState().currentTrack, direction);
  if (next !== undefined) selectTrack(services, next);
}

function mixOf(services: TrackServices, id: Id) {
  const track = trackOf(services, id);
  return track && effectiveMix(track, services.playback.getState().mixer[id]);
}

export function toggleMute(services: TrackServices, id: Id): void {
  const mix = mixOf(services, id);
  if (mix) services.audio.setTrack(id, { mute: !mix.mute });
}

export function toggleSolo(services: TrackServices, id: Id): void {
  const mix = mixOf(services, id);
  if (mix) services.audio.setTrack(id, { solo: !mix.solo });
}

export function clearMuteSolo(services: TrackServices): void {
  const { score } = services.document.getState();
  const { mixer } = services.playback.getState();
  for (const track of score?.tracks ?? []) {
    const mix = effectiveMix(track, mixer[track.id]);
    if (mix.mute || mix.solo) services.audio.setTrack(track.id, { mute: false, solo: false });
  }
}

export function setTrackVisible(services: TrackServices, id: Id, visible: boolean): void {
  const { score, view } = services.document.getState();
  if (!score) return;
  const next = nextVisibility(score.tracks, view.tracks, id, visible);
  if (next !== undefined) services.document.getState().setVisibleTracks(next);
}

export function showAllTracks(services: TrackServices): void {
  const { document } = services;
  if (!document.getState().score) return;
  document.getState().setView({ tracks: 'all' });
}

export function toggleMultitrack(services: TrackServices): void {
  const { document, selection } = services;
  const { score, view } = document.getState();
  if (!score) return;
  if (singleTrackOf(view, score) !== undefined) {
    document.getState().setSingleTrack(undefined);
    return;
  }
  const current = selection.getState().currentTrack ?? score.tracks[0]?.id;
  if (current !== undefined) document.getState().setSingleTrack(current);
}

export function setTrackNotation(services: TrackServices, id: Id, notation: Notation): void {
  if (trackOf(services, id)) services.document.getState().setNotation(id, notation);
}

export function previewVolume(services: TrackServices, id: Id, volume: number): void {
  services.audio.previewTrack(id, { volume });
}

export function previewPan(services: TrackServices, id: Id, pan: number): void {
  services.audio.previewTrack(id, { pan });
}

/** One undo step per call; a value equal to the current one adds none. */
export function commitVolume(services: TrackServices, id: Id, volume: number): void {
  if (trackOf(services, id)) {
    services.document
      .getState()
      .apply(setTrackProperties({ trackId: id }, { channel: { volume } }));
  }
}

export function commitPan(services: TrackServices, id: Id, pan: number): void {
  if (trackOf(services, id)) {
    services.document.getState().apply(setTrackProperties({ trackId: id }, { channel: { pan } }));
  }
}

export function setProgram(services: TrackServices, id: Id, program: number): void {
  if (trackOf(services, id)) {
    services.document.getState().apply(setTrackProperties({ trackId: id }, { program }));
  }
}

export interface TrackActions {
  selectTrack: (id: Id) => void;
  toggleMute: (id: Id) => void;
  toggleSolo: (id: Id) => void;
  setTrackVisible: (id: Id, visible: boolean) => void;
  toggleMultitrack: () => void;
  setTrackNotation: (id: Id, notation: Notation) => void;
  previewVolume: (id: Id, volume: number) => void;
  previewPan: (id: Id, pan: number) => void;
  commitVolume: (id: Id, volume: number) => void;
  commitPan: (id: Id, pan: number) => void;
  setProgram: (id: Id, program: number) => void;
}

/** The actions bound to the app's services, stable for the services' lifetime. */
export function useTrackActions(): TrackActions {
  const services = useAppServices();
  return useMemo(
    () => ({
      selectTrack: (id) => {
        selectTrack(services, id);
      },
      toggleMute: (id) => {
        toggleMute(services, id);
      },
      toggleSolo: (id) => {
        toggleSolo(services, id);
      },
      setTrackVisible: (id, visible) => {
        setTrackVisible(services, id, visible);
      },
      toggleMultitrack: () => {
        toggleMultitrack(services);
      },
      setTrackNotation: (id, notation) => {
        setTrackNotation(services, id, notation);
      },
      previewVolume: (id, volume) => {
        previewVolume(services, id, volume);
      },
      previewPan: (id, pan) => {
        previewPan(services, id, pan);
      },
      commitVolume: (id, volume) => {
        commitVolume(services, id, volume);
      },
      commitPan: (id, pan) => {
        commitPan(services, id, pan);
      },
      setProgram: (id, program) => {
        setProgram(services, id, program);
      },
    }),
    [services],
  );
}
