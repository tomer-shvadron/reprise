import { CommandError } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { describeRefusal } from './refusal';

describe('describeRefusal', () => {
  it('words the refusals a player meets, and strips the command name from the rest', () => {
    expect(describeRefusal(new CommandError('setNote', 'voice-overfull', 'x'))).toBe(
      'That does not fit in the bar',
    );
    expect(describeRefusal(new CommandError('setNote', 'not-fretted', 'x'))).toBe(
      'Note entry works on fretted tracks only',
    );
    expect(describeRefusal(new CommandError('removeBar', 'last-bar', 'the last bar stays'))).toBe(
      'The last bar stays',
    );
  });

  it('leaves anything but a refusal to the caller', () => {
    expect(describeRefusal(new Error('bug'))).toBeUndefined();
    expect(describeRefusal('text')).toBeUndefined();
  });
});
