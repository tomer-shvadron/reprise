import { CommandError, applyCommand, insertBeat, setNote } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { describeRefusal } from './refusal';
import { fullBarScore } from './test/entry-scores';

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

  it('maps a real refused applyCommand on its violated rule, with no path or command name', () => {
    const score = fullBarScore();
    const voice = score.tracks[0]?.bars[0]?.voices[0];
    if (!voice) throw new Error('no voice');
    const refusal = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error;
      }
      throw new Error('not refused');
    };
    const overfull = refusal(() =>
      applyCommand(score, insertBeat({ voiceId: voice.id, index: 4 }, { duration: 4 })),
    );
    expect(overfull).toBeInstanceOf(CommandError);
    expect(describeRefusal(overfull)).toBe('That does not fit in the bar');
    const fret = refusal(() =>
      applyCommand(score, setNote({ beatId: voice.beats[0]?.id ?? '' }, { string: 1, fret: 99 })),
    );
    const text = describeRefusal(fret);
    expect(text).toBeDefined();
    expect(text).not.toMatch(/setNote|tracks\.|\.\d/);
  });
});
