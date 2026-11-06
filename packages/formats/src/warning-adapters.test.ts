import { formatPath } from '@reprise/model';
import type { NativePath } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import type { GpifWarning, GpifWarningCode } from './gpif/warnings';
import {
  GPIF_SEVERITY,
  fromGpifDropped,
  fromGpifWarning,
  withFoldedCount,
  fromParseWarning,
  parseModelPath,
} from './warning-adapters';
import type { WarningSeverity } from './warnings';

const gpif = (warning: Partial<GpifWarning>): GpifWarning => ({
  code: 'not-modelled',
  message: 'm',
  path: 'Notes/Note[3]',
  count: 1,
  ...warning,
});

describe('fromGpifWarning', () => {
  const table: [GpifWarningCode, WarningSeverity][] = [
    ['voice-dropped', 'error'],
    ['unknown-element', 'warning'],
    ['unknown-value', 'warning'],
    ['invalid-value', 'warning'],
    ['missing-reference', 'warning'],
    ['multiple-staves', 'warning'],
    ['simile-expanded', 'warning'],
    ['grace-without-beat', 'warning'],
    ['grace-duration-clamped', 'warning'],
    ['grace-tie-released', 'warning'],
    ['hammer-pull-without-destination', 'warning'],
    ['tempo-moved', 'warning'],
    ['automation-dropped', 'warning'],
    ['default-tempo', 'warning'],
    ['not-modelled', 'info'],
    ['long-note-tied', 'info'],
    ['drum-articulation', 'info'],
  ];

  it.each(table)('gives %s the severity %s', (code, severity) => {
    expect(fromGpifWarning(gpif({ code })).severity).toBe(severity);
  });

  it('covers every gpif reader code', () => {
    expect(table).toHaveLength(Object.keys(GPIF_SEVERITY).length);
  });

  it('keeps a gpif element path as the element', () => {
    expect(fromGpifWarning(gpif({ path: 'Notes/Note[3]/Properties/Property[Slide]' }))).toEqual({
      code: 'not-modelled',
      severity: 'info',
      message: 'm',
      location: { element: 'Notes/Note[3]/Properties/Property[Slide]' },
    });
  });

  it('turns a violation path into a score path', () => {
    const warning = fromGpifWarning(
      gpif({ code: 'voice-overfull', path: 'score.tracks[0].bars[1].voices[1]', count: 3 }),
    );
    expect(warning).toEqual({
      code: 'voice-overfull',
      severity: 'warning',
      message: 'm',
      location: { path: ['tracks', 0, 'bars', 1, 'voices', 1] },
      count: 3,
    });
  });
});

describe('fromGpifDropped', () => {
  it('gives every loss the severity warning at its score path', () => {
    const once = fromGpifDropped({
      code: 'trill-speed',
      message: 'm',
      path: 'score.tracks[0].bars[0].voices[0].beats[0].notes[0].trill.speed',
      count: 1,
    });
    expect(once).toEqual({
      code: 'trill-speed',
      severity: 'warning',
      message: 'm',
      location: {
        path: ['tracks', 0, 'bars', 0, 'voices', 0, 'beats', 0, 'notes', 0, 'trill', 'speed'],
      },
    });
    const folded = fromGpifDropped({
      code: 'mixer-change',
      message: 'm',
      path: 'score.tracks[1]',
      count: 3,
    });
    expect(folded).toMatchObject({
      severity: 'warning',
      location: { path: ['tracks', 1] },
      count: 3,
    });
  });
});

describe('withFoldedCount', () => {
  it('drops a count of 1 and keeps a larger one', () => {
    const base = { code: 'rse-dropped', severity: 'info', message: 'm', location: {} } as const;
    expect(withFoldedCount({ ...base, count: 1 })).toEqual(base);
    expect(withFoldedCount({ ...base, count: 3 })).toEqual({ ...base, count: 3 });
    expect(withFoldedCount(base)).toEqual(base);
  });
});

describe('fromParseWarning', () => {
  it('strips the score root and names an envelope field as an element', () => {
    const score = fromParseWarning({
      code: 'unknown-field',
      path: ['score', 'tracks', 0],
      message: 'm',
    });
    expect(score).toEqual({
      code: 'unknown-field',
      severity: 'warning',
      message: 'm',
      location: { path: ['tracks', 0] },
    });
    const app = fromParseWarning({ code: 'unknown-field', path: ['app', 'x'], message: 'm' });
    expect(app.location).toEqual({ element: 'app.x' });
  });

  it('keeps a top-level field apart from a score field of the same name', () => {
    const top = fromParseWarning({ code: 'unknown-field', path: ['extra'], message: 'm' });
    const inScore = fromParseWarning({
      code: 'unknown-field',
      path: ['score', 'extra'],
      message: 'm',
    });
    expect(top.location).toEqual({ element: 'extra' });
    expect(inScore.location).toEqual({ path: ['extra'] });
  });
});

describe('parseModelPath', () => {
  it.each<[NativePath]>([
    [[]],
    [['score']],
    [['tracks', 0]],
    [['score', 'tracks', 12, 'bars', 3, 'voices', 0, 'beats', 7, 'notes', 2]],
    [['masterBars', 0, 'alternateEndings']],
  ])('inverts formatPath for %j', (path) => {
    expect(parseModelPath(formatPath(path))).toEqual(path);
  });
});
