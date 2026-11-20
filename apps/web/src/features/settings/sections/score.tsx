import { DEFAULT_VIEW_MODE_SETTING, DEFAULT_ZOOM_SETTING } from '@/state/app-settings';
import { ZOOM } from '@/state/ui';

import type { SettingsSection } from '../section';
import { ChoiceSetting, SliderSetting } from '../setting-rows';

function Score() {
  return (
    <>
      <ChoiceSetting
        def={DEFAULT_VIEW_MODE_SETTING}
        label="Default view"
        description="How a score is laid out when the app starts. Changing it also changes the view now."
        choices={[
          { value: 'paged', label: 'Page' },
          { value: 'continuous', label: 'Continuous' },
        ]}
      />
      <SliderSetting
        def={DEFAULT_ZOOM_SETTING}
        label="Default zoom"
        description="Actual size (⌘0 or Ctrl+0) stays 100%."
        min={ZOOM.min}
        max={ZOOM.max}
        step={0.1}
      />
    </>
  );
}

export const scoreSection: SettingsSection = {
  id: 'score',
  title: 'Score',
  settings: [DEFAULT_VIEW_MODE_SETTING, DEFAULT_ZOOM_SETTING],
  Component: Score,
};
