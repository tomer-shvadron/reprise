import { describe, expect, it } from 'vitest';

import { COUNT_IN_SETTING, THEME_SETTING } from '@/state/app-settings';

import { checkSections, type SettingsSection } from './section';

const section = (id: string, settings: SettingsSection['settings']): SettingsSection => ({
  id,
  title: id,
  settings,
  Component: () => null,
});

describe('checkSections', () => {
  it('accepts sections with distinct ids and keys', () => {
    expect(() => {
      checkSections([section('a', [THEME_SETTING]), section('b', [COUNT_IN_SETTING])]);
    }).not.toThrow();
  });

  it('throws on a repeated id', () => {
    expect(() => {
      checkSections([section('a', []), section('a', [])]);
    }).toThrow(/share the id "a"/);
  });

  it('throws on a key two sections both reset', () => {
    expect(() => {
      checkSections([section('a', [THEME_SETTING]), section('b', [THEME_SETTING])]);
    }).toThrow(/"appearance.theme" is in both "a" and "b"/);
  });
});
