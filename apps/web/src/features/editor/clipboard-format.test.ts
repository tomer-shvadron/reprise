import { describe, expect, it } from 'vitest';

import { copyClip } from './clip';
import { MAX_CLIPBOARD_CHARS, parseClip, serializeClip } from './clipboard-format';
import { beatsRange, clipboardScore } from './test/clip-scores';
import { must } from './test/must';

function sample() {
  const built = clipboardScore();
  const result = copyClip(built, {
    cursor: undefined,
    range: beatsRange(built, { first: 0, last: 1, bar: 0, from: 0, to: 1 }),
  });
  if ('refused' in result) throw new Error(result.refused);
  return result.clip;
}

describe('the clipboard text', () => {
  it('is a versioned line, then the clip as one line of JSON, and round-trips', () => {
    const clip = sample();
    const text = serializeClip(clip);
    const [header, json, ...rest] = text.split('\n');
    expect(header).toBe('Reprise clipboard 1');
    expect(rest).toEqual([]);
    expect(() => {
      JSON.parse(must(json));
    }).not.toThrow();
    expect(parseClip(text)).toEqual(clip);
  });

  it('is not a clip when the text is foreign, another version, malformed or oversized', () => {
    const text = serializeClip(sample());
    expect(parseClip('')).toBeUndefined();
    expect(parseClip('just some words')).toBeUndefined();
    expect(parseClip(text.replace('clipboard 1', 'clipboard 2'))).toBeUndefined();
    expect(parseClip(text.replace('"version":1', '"version":2'))).toBeUndefined();
    expect(parseClip(`Reprise clipboard 1\n{"kind":`)).toBeUndefined();
    expect(
      parseClip(`Reprise clipboard 1\n{"version":1,"kind":"beats","tracks":[]}`),
    ).toBeUndefined();
    expect(parseClip(`${text}${' '.repeat(MAX_CLIPBOARD_CHARS)}`)).toBeUndefined();
  });

  it('strips fields it does not know', () => {
    const clip = sample();
    expect(parseClip(`Reprise clipboard 1\n${JSON.stringify({ ...clip, extra: 1 })}`)).toEqual(
      clip,
    );
  });
});
