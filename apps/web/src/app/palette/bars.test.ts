import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { barRow } from './bars';

const built = score().track('guitar').bar().section('Verse').bar().bar().bar().build();

describe('barRow', () => {
  it('goes to a bar, with its section', () => {
    expect(barRow(built, '1')).toEqual({
      kind: 'bar',
      index: 0,
      label: 'Go to bar 1',
      detail: 'Verse',
    });
    expect(barRow(built, '004')).toMatchObject({ kind: 'bar', index: 3 });
  });

  it('says how many bars the song has when out of range', () => {
    expect(barRow(built, '0')).toEqual({ kind: 'message', message: 'This song has 4 bars.' });
    expect(barRow(built, '5')).toMatchObject({ kind: 'message' });
  });

  it('counts an anacrusis as bar 1', () => {
    const pickup = score().track('guitar').bar().anacrusis().bar().build();
    expect(barRow(pickup, '2')).toMatchObject({ kind: 'bar', index: 1 });
  });

  it('needs a score', () => {
    expect(barRow(undefined, '3')).toEqual({
      kind: 'message',
      message: 'Open a song to go to a bar.',
    });
  });
});
