import {
  DEFAULT_NOTATION_STRINGS_SETTING,
  DEFAULT_NOTATION_VOCALS_SETTING,
  DEFAULT_VIEW_MODE_SETTING,
  DEFAULT_ZOOM_SETTING,
} from '@/state/app-settings';
import { ZOOM } from '@/state/ui';

import type { SettingsSection } from '../section';
import { ChoiceSetting, SliderSetting } from '../setting-rows';

const NOTATION_CHOICES = [
  { value: 'tab', label: 'Tab' },
  { value: 'standard', label: 'Standard' },
  { value: 'both', label: 'Both' },
] as const;

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
        description="The Actual size command always goes back to 100%."
        min={ZOOM.min}
        max={ZOOM.max}
        step={0.1}
      />
      <ChoiceSetting
        def={DEFAULT_NOTATION_STRINGS_SETTING}
        label="String instruments"
        description="Guitars, basses and other fretted tracks, when the file does not say."
        choices={NOTATION_CHOICES}
      />
      <ChoiceSetting
        def={DEFAULT_NOTATION_VOCALS_SETTING}
        label="Vocals"
        description="Vocal tracks, by their instrument or their name, when the file does not say."
        choices={NOTATION_CHOICES}
      />
      <p className="text-muted-foreground text-sm">
        Drums, keyboards and other instruments open in standard notation. A file that says how to
        show a track keeps it; the change applies to files opened from now on.
      </p>
    </>
  );
}

export const scoreSection: SettingsSection = {
  id: 'score',
  title: 'Score',
  settings: [
    DEFAULT_VIEW_MODE_SETTING,
    DEFAULT_ZOOM_SETTING,
    DEFAULT_NOTATION_STRINGS_SETTING,
    DEFAULT_NOTATION_VOCALS_SETTING,
  ],
  Component: Score,
};
