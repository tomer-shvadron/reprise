import {
  COUNT_IN_SETTING,
  COUNT_IN_VOLUME_SETTING,
  EDIT_SOUND_SETTING,
  FOLLOW_PLAYHEAD_SETTING,
  METRONOME_VOLUME_SETTING,
} from '@/state/app-settings';

import type { SettingsSection } from '../section';
import { SliderSetting, SwitchSetting } from '../setting-rows';

function Playback() {
  return (
    <>
      <SwitchSetting
        def={COUNT_IN_SETTING}
        label="Count-in"
        description="Click one bar before playback starts."
      />
      <SliderSetting
        def={COUNT_IN_VOLUME_SETTING}
        label="Count-in volume"
        description="The level of the count-in clicks, apart from the metronome's."
        min={0}
        max={1}
        step={0.05}
      />
      <SliderSetting
        def={METRONOME_VOLUME_SETTING}
        label="Metronome volume"
        min={0}
        max={1}
        step={0.05}
      />
      <SwitchSetting
        def={FOLLOW_PLAYHEAD_SETTING}
        label="Follow the playhead"
        description="Scroll the score to keep the playhead in view. Off, the view never scrolls on its own."
      />
      <SwitchSetting
        def={EDIT_SOUND_SETTING}
        label="Sound notes while editing"
        description="Play a note when you enter it and the beat when you apply an effect."
      />
    </>
  );
}

export const playbackSection: SettingsSection = {
  id: 'playback',
  title: 'Playback and practice',
  settings: [
    COUNT_IN_SETTING,
    COUNT_IN_VOLUME_SETTING,
    METRONOME_VOLUME_SETTING,
    FOLLOW_PLAYHEAD_SETTING,
    EDIT_SOUND_SETTING,
  ],
  Component: Playback,
};
