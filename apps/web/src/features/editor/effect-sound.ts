import { EDIT_SOUND_SETTING } from '@/state/app-settings';
import { selectRunning } from '@/state/playback';

import type { EffectServices } from './effect-commands';
import type { EffectSound } from './effects';

/**
 * Sounds the beat an effect was just applied to, so the user hears what it did. Silent when the
 * setting is off and while the song plays or counts in (a beat sounded over the playing song is noise). The
 * edit is done by now, so a failing preview is logged, never thrown.
 */
export function soundEffect(
  services: Pick<EffectServices, 'audio' | 'playback' | 'settings'>,
  sound: EffectSound,
): void {
  if (!services.settings.get(EDIT_SOUND_SETTING)) return;
  if (selectRunning(services.playback.getState())) return;
  try {
    services.audio.previewBeat(sound.track, sound.beat);
  } catch (error) {
    console.error(error);
  }
}
