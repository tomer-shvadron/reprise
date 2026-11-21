import {
  appearanceSection,
  keyboardSection,
  playbackSection,
  scoreSection,
} from '@/features/settings';

/**
 * The Settings dialog's sections, in order. A feature adds its section here, with its own folder's
 * component; the dialog, the store and the rows stay as they are.
 */
export const SETTINGS_SECTIONS = [
  appearanceSection,
  scoreSection,
  playbackSection,
  keyboardSection,
];
