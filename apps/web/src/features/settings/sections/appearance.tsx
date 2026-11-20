import { THEME_SETTING } from '@/state/app-settings';

import type { SettingsSection } from '../section';
import { ChoiceSetting } from '../setting-rows';

function Appearance() {
  return (
    <ChoiceSetting
      def={THEME_SETTING}
      label="Theme"
      description="System follows your operating system's light or dark setting."
      choices={[
        { value: 'system', label: 'System' },
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
      ]}
    />
  );
}

export const appearanceSection: SettingsSection = {
  id: 'appearance',
  title: 'Appearance',
  settings: [THEME_SETTING],
  Component: Appearance,
};
