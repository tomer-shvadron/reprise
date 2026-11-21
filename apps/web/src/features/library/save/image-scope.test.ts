import type { Score } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { DocumentView } from '@/state/document';
import type { SelectionState } from '@/state/selection';

import { imageScopeOf } from './ascii-scope';

function song(): Score {
  const builder = score().title('Scope').track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < 3; bar++) builder.bar().beat('4', [note(1, bar)]);
  builder.track('guitar', { name: 'Rhythm' });
  for (let bar = 0; bar < 3; bar++) builder.bar().beat('4', [note(1, bar)]);
  builder.track('drums', { name: 'Kit' });
  for (let bar = 0; bar < 3; bar++) builder.bar().beat('4', [midi(36)]);
  return builder.build({ ids: 'sequential' });
}

const view = (tracks: DocumentView['tracks']): DocumentView => ({ tracks, notation: {} });
const none: Pick<SelectionState, 'range' | 'bars' | 'currentTrack'> = {
  range: undefined,
  bars: undefined,
  currentTrack: undefined,
};

describe('imageScopeOf', () => {
  const built = song();
  const [lead, rhythm, kit] = built.tracks.map(({ id }) => id);
  const bar = (i: number) => built.masterBars[i]?.id ?? '';
  if (!lead || !rhythm || !kit) throw new Error('fixture');

  it('takes an edit range its visible tracks and its bars', () => {
    const range = {
      kind: 'bars' as const,
      anchor: { track: lead, masterBar: bar(1), beat: undefined },
      focus: { track: rhythm, masterBar: bar(2), beat: undefined },
    };
    expect(
      imageScopeOf(built, { ...none, range, currentTrack: lead }, undefined, view('all')),
    ).toEqual({ tracks: [lead, rhythm], bars: { start: 1, end: 3 } });
  });

  it('leaves out a track of the range that the view hides', () => {
    const range = {
      kind: 'bars' as const,
      anchor: { track: lead, masterBar: bar(0), beat: undefined },
      focus: { track: kit, masterBar: bar(0), beat: undefined },
    };
    expect(
      imageScopeOf(built, { ...none, range, currentTrack: lead }, undefined, view([lead, kit])),
    ).toEqual({ tracks: [lead, kit], bars: { start: 0, end: 1 } });
  });

  it('gives a play-mode bar selection every track on screen, not the current track', () => {
    const bars = { startBar: bar(0), endBar: bar(1) };
    expect(
      imageScopeOf(built, { ...none, bars, currentTrack: lead }, undefined, view('all')),
    ).toEqual({ tracks: [lead, rhythm, kit], bars: { start: 0, end: 2 } });
    expect(
      imageScopeOf(built, { ...none, bars, currentTrack: lead }, undefined, view([lead, rhythm])),
    ).toEqual({ tracks: [lead, rhythm], bars: { start: 0, end: 2 } });
  });

  it('gives a bar target every track on screen', () => {
    expect(
      imageScopeOf(
        built,
        { ...none, currentTrack: lead },
        { kind: 'bar', masterBar: bar(2), track: rhythm },
        view('all'),
      ),
    ).toEqual({ tracks: [lead, rhythm, kit], bars: { start: 2, end: 3 } });
  });

  it('is undefined with nothing selected', () => {
    expect(imageScopeOf(built, none, undefined, view('all'))).toBeUndefined();
  });
});
