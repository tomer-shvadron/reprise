import { describe, expect, it } from 'vitest';

import { historyLabel } from './history-labels';

describe('historyLabel', () => {
  it('names the commands the editor records', () => {
    expect(historyLabel('insertBar')).toBe('Insert bar');
    expect(historyLabel('enterNote')).toBe('Enter note');
    expect(historyLabel('setNoteEffects')).toBe('Change note effects');
    expect(historyLabel('deleteBars')).toBe('Delete bars');
    expect(historyLabel('setTrackProperties')).toBe('Track properties');
  });

  it('calls both paste chains Paste and both cut chains Cut', () => {
    expect(historyLabel('pasteBars')).toBe('Paste');
    expect(historyLabel('pasteBeats')).toBe('Paste');
    expect(historyLabel('cutBars')).toBe('Cut');
    expect(historyLabel('cutBeats')).toBe('Cut');
  });

  it('keeps a name that already reads as text, capitalised', () => {
    expect(historyLabel('palm mute')).toBe('Palm mute');
    expect(historyLabel('dynamics ff')).toBe('Dynamics ff');
    expect(historyLabel('Palm mute')).toBe('Palm mute');
  });

  it('turns an unknown id into sentence case', () => {
    expect(historyLabel('splitBarInTwo')).toBe('Split bar in two');
    expect(historyLabel('some_kebab-case.id')).toBe('Some kebab case id');
    expect(historyLabel('x')).toBe('X');
    expect(historyLabel('')).toBe('');
  });
});
