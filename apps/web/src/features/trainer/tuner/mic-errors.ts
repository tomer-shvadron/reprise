export type TunerErrorKind = 'denied' | 'noDevice' | 'busy' | 'unsupported' | 'lost' | 'failed';

export interface TunerError {
  kind: TunerErrorKind;
  message: string;
  /** Whether "Try again" makes sense. */
  retry: boolean;
}

const MESSAGES = {
  denied:
    'Microphone access is blocked. Allow it for Reprise in your system or browser settings, then try again. On macOS you may need to restart Reprise.',
  noDevice: 'No microphone found. Connect one and try again.',
  busy: "The microphone is in use by another app or isn't working.",
  unsupported: "This browser can't use the microphone here.",
  lost: 'The microphone was disconnected.',
} as const;

export function tunerError(kind: Exclude<TunerErrorKind, 'failed'>): TunerError {
  return { kind, message: MESSAGES[kind], retry: kind !== 'unsupported' };
}

const nameOf = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
    ? error.name
    : undefined;

/** Anything the microphone request or the audio graph threw that is not a known cause. */
export function failedError(error: unknown): TunerError {
  const detail = error instanceof Error && error.message ? error.message : 'unknown error';
  return { kind: 'failed', message: `Couldn't start the microphone: ${detail}`, retry: true };
}

/** Maps a `getUserMedia` rejection to what the panel tells the user. */
export function micErrorOf(error: unknown): TunerError {
  switch (nameOf(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return tunerError('denied');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return tunerError('noDevice');
    case 'NotReadableError':
    case 'AbortError':
      return tunerError('busy');
    case 'TypeError':
      return tunerError('unsupported');
    default:
      return failedError(error);
  }
}
