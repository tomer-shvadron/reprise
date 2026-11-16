import { describe, expect, it } from 'vitest';

import { micErrorOf, tunerError } from './mic-errors';

const named = (name: string) => new DOMException('x', name);

describe('micErrorOf', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'noDevice'],
    ['OverconstrainedError', 'noDevice'],
    ['NotReadableError', 'busy'],
    ['AbortError', 'busy'],
  ])('maps %s to %s', (name, kind) => {
    expect(micErrorOf(named(name)).kind).toBe(kind);
  });

  it('maps a TypeError to unsupported, with no retry', () => {
    const error = micErrorOf(new TypeError('no mediaDevices'));
    expect(error).toMatchObject({ kind: 'unsupported', retry: false });
  });

  it('keeps the message of anything else', () => {
    expect(micErrorOf(new Error('boom'))).toEqual({
      kind: 'failed',
      message: "Couldn't start the microphone: boom",
      retry: true,
    });
    expect(micErrorOf('odd').kind).toBe('failed');
  });

  it('explains a lost device', () => {
    expect(tunerError('lost').message).toBe('The microphone was disconnected.');
  });
});
