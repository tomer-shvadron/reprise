import type { AppServices } from '@/app/services';
import type { TransportSettings } from '@/state/playback';
import type { FakeAudioService } from '@/test/services';

/** Makes the fake's setters write `settings` as the real service does, so the bar follows. */
export function mirrorAudio(services: AppServices & { fakeAudio: FakeAudioService }): void {
  const { fakeAudio, playback } = services;
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
}
