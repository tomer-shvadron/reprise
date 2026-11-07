import type { AppServices } from '@/app/services';
import type { TransportSettings } from '@/state/playback';
import { positionEventAt } from './position';
import type { FakeAudioService } from './services';

/**
 * Makes the fake's setters write `settings` and `mixer`, and its seek the position, as the real
 * service does, so the UI follows.
 */
export function mirrorAudio(services: AppServices & { fakeAudio: FakeAudioService }): void {
  const { fakeAudio, playback, document } = services;
  const settings = (partial: Partial<TransportSettings>) => {
    playback.setState({ settings: { ...playback.getState().settings, ...partial } });
  };
  fakeAudio.setTempo.mockImplementation((mode, value) => {
    settings({ tempo: { mode, value } });
  });
  fakeAudio.setLoop.mockImplementation((loop) => {
    settings({ loop });
  });
  fakeAudio.setCountIn.mockImplementation((countIn) => {
    settings({ countIn });
  });
  fakeAudio.setMetronome.mockImplementation((on, volume) => {
    settings({ metronome: { on, volume } });
  });
  fakeAudio.setMasterVolume.mockImplementation((masterVolume) => {
    settings({ masterVolume });
  });
  fakeAudio.seek.mockImplementation((tick) => {
    const { score } = document.getState();
    if (score) playback.setState({ position: positionEventAt(score, tick) });
  });
  fakeAudio.setTrack.mockImplementation((id, params) => {
    const { mixer } = playback.getState();
    playback.setState({ mixer: { ...mixer, [id]: { ...mixer[id], ...params } } });
  });
}
