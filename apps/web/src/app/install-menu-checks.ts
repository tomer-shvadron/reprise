import type { MenuChecks } from '@/platform/bridge';
import type { Platform } from '@/platform/platform';
import type { PlaybackStore, TransportSettings } from '@/state/playback';

/** The checkbox items of the native Playback menu, from the playback settings. */
export function menuChecksOf(settings: TransportSettings): MenuChecks {
  return {
    'transport.toggleLoop': settings.loop !== undefined,
    'transport.toggleCountIn': settings.countIn,
    'transport.toggleMetronome': settings.metronome.on,
    'transport.toggleFixedTempo': settings.tempo.mode === 'bpm',
  };
}

/**
 * Gives the native Playback menu the state of its checkbox items (and, through Fixed Tempo, the
 * unit of Slow Down and Speed Up). Pushes at once and on every change, skips an unchanged map and
 * retries a push that was refused or failed on the next change, as `installMenuKeys` does. Does
 * nothing on a platform without a menu. Returns the undo.
 */
export function installMenuChecks(deps: {
  playback: PlaybackStore;
  platform: Pick<Platform, 'setMenuChecks'>;
}): () => void {
  const { playback, platform } = deps;
  const { setMenuChecks } = platform;
  if (!setMenuChecks) return () => undefined;
  let last = '';
  let active = true;
  const push = () => {
    if (!active) return;
    const checks = menuChecksOf(playback.getState().settings);
    const text = JSON.stringify(checks);
    if (text === last) return;
    void setMenuChecks.call(platform, checks).then((applied) => {
      if (applied) last = text;
    });
  };
  push();
  const stop = playback.subscribe(push);
  return () => {
    active = false;
    stop();
  };
}
