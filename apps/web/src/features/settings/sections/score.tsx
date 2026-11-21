import { NOTATION_NAMES } from '@/features/tracks';
import {
  CHORD_DIAGRAMS_SETTING,
  CHORD_STRIP_SETTING,
  DEFAULT_NOTATION_STRINGS_SETTING,
  DEFAULT_NOTATION_VOCALS_SETTING,
  DEFAULT_VIEW_MODE_SETTING,
  DEFAULT_ZOOM_SETTING,
} from '@/state/app-settings';
import { ZOOM } from '@/state/ui';

import type { SettingsSection } from '../section';
import { ChoiceSetting, SliderSetting, SwitchSetting } from '../setting-rows';

const NOTATION_CHOICES = [
  { value: 'tab', label: 'Tab', ariaLabel: NOTATION_NAMES.tab },
  { value: 'standard', label: 'Standard', ariaLabel: NOTATION_NAMES.standard },
  { value: 'both', label: 'Both', ariaLabel: NOTATION_NAMES.both },
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
      <SwitchSetting
        def={CHORD_DIAGRAMS_SETTING}
        label="Chord diagrams"
        description="Draw the chord grids a file carries above the staff. Printing follows it."
      />
      <SwitchSetting
        def={CHORD_STRIP_SETTING}
        label="Chord strip"
        description="Dock the current track's chords, each with its shape, above the score. Printing follows it."
      />
      <ChoiceSetting
        def={DEFAULT_NOTATION_STRINGS_SETTING}
        label="Notation for string instruments"
        description="Guitars, basses and other fretted tracks, when the file does not say."
        choices={NOTATION_CHOICES}
      />
      <ChoiceSetting
        def={DEFAULT_NOTATION_VOCALS_SETTING}
        label="Notation for vocals"
        description="Vocal tracks, by their instrument or their name, when the file does not say."
        choices={NOTATION_CHOICES}
      />
      <p className="text-muted-foreground py-3 text-xs last:border-b-0">
        Drums, keyboards and other instruments open in standard notation. A file that says how to
        show a track keeps it. The defaults apply to a file opened or imported for the first time; a
        file already in the library keeps its notation.
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
    CHORD_DIAGRAMS_SETTING,
    CHORD_STRIP_SETTING,
    DEFAULT_NOTATION_STRINGS_SETTING,
    DEFAULT_NOTATION_VOCALS_SETTING,
  ],
  Component: Score,
};
