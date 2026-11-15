import { CommandError } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { refusalMessage } from './track-refusal';

describe('refusalMessage', () => {
  it('drops the command prefix and words the last-track refusal', () => {
    expect(refusalMessage(new CommandError('setTrackProperties', 'invariant', 'no way'))).toBe(
      'no way',
    );
    expect(refusalMessage(new CommandError('removeTrack', 'last-track', 'x'))).toBe(
      'A score keeps at least one track.',
    );
    expect(refusalMessage(new Error('plain'))).toBe('plain');
  });
});
