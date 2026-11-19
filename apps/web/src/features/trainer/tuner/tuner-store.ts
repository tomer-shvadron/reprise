import type { Track } from '@reprise/model';
import { create } from 'zustand';

import type { AppServices } from '@/app/services';

import {
  ContextNotStartedError,
  createCaptureContext,
  openCapture,
  type TunerInput,
} from './capture';
import { failedError, micErrorOf, tunerError, type TunerError } from './mic-errors';
import { isValidReference, REFERENCE_HZ } from './notes';
import { createDetector, rms, type Detector } from './pitch/mpm';
import { createTracker, settleFramesFor, type Reading } from './pitch/tracker';
import {
  FLAT_ALLOWANCE,
  MAX_DETECT_HZ,
  lowestTargetHz,
  pickString,
  stringTargets,
  windowFor,
  type StringSet,
} from './strings';

export type TunerStatus = 'idle' | 'starting' | 'listening' | 'error';

export const REFERENCE_STORAGE_KEY = 'reprise.tuner.referenceHz';
export const HOP_MS = 20;
export const DEVICE_CHANGE_DEBOUNCE_MS = 500;

export type TunerServices = Pick<AppServices, 'platform' | 'document' | 'selection'>;

/** What the store needs from the outside; tests replace each. */
export interface TunerDeps {
  createContext?: () => AudioContext;
  openCapture?: (
    stream: MediaStream,
    context: AudioContext,
    frameSize: number,
  ) => Promise<TunerInput>;
  storage?: () => Storage;
  /** Wall clock in ms; times the tracker's hold, which must expire when the audio clock stops. */
  now?: () => number;
  /** Where `devicechange` arrives; `navigator.mediaDevices` by default. */
  mediaDevices?: EventTarget | undefined;
  schedule?: {
    every(run: () => void, ms: number): () => void;
    after(run: () => void, ms: number): () => void;
  };
  /** The page's visibility, `document` by default. */
  page?: Pick<Document, 'addEventListener' | 'removeEventListener'> & {
    readonly visibilityState: DocumentVisibilityState;
  };
}

export interface TunerState {
  status: TunerStatus;
  error: TunerError | undefined;
  reading: Reading | undefined;
  referenceHz: number;
  /** The string the user picked, overriding auto. */
  override: number | undefined;
  /** The string auto settled on for the reading. */
  autoString: number | undefined;
  /** The user wants the tuner listening; set by Start, cleared by Stop and a permission error. */
  wanted: boolean;
  start(): void;
  stop(): void;
  toggle(): void;
  /** Sets A4; false (and no change) when it is not a whole number from 415 to 466. */
  setReference(hz: number): boolean;
  selectString(string: number | undefined): void;
  /** For the panel's lifetime: capture runs only while it is attached. Returns the detach. */
  attach(): () => void;
}

function readReference(storage: () => Storage): number {
  try {
    const stored = Number(storage().getItem(REFERENCE_STORAGE_KEY));
    return isValidReference(stored) ? stored : REFERENCE_HZ.default;
  } catch {
    return REFERENCE_HZ.default;
  }
}

const trackOf = (services: TunerServices): Track | undefined => {
  const { score } = services.document.getState();
  const id = services.selection.getState().currentTrack;
  return score?.tracks.find((track) => track.id === id);
};

export function createTuner(services: TunerServices, deps: TunerDeps = {}) {
  const { platform, document, selection } = services;
  const storage = deps.storage ?? (() => window.localStorage);
  const makeContext = deps.createContext ?? createCaptureContext;
  const open = deps.openCapture ?? openCapture;
  const schedule = deps.schedule ?? {
    every(run, ms) {
      const id = setInterval(run, ms);
      return () => {
        clearInterval(id);
      };
    },
    after(run, ms) {
      const id = setTimeout(run, ms);
      return () => {
        clearTimeout(id);
      };
    },
  };
  const page = deps.page ?? globalThis.document;
  const mediaDevices =
    'mediaDevices' in deps
      ? deps.mediaDevices
      : typeof navigator === 'undefined'
        ? undefined
        : (navigator.mediaDevices as EventTarget | undefined);

  const now = deps.now ?? (() => performance.now());
  const referenceHz = readReference(storage);
  const tracker = createTracker({ referenceHz });

  let attached = false;
  let capture: TunerInput | undefined;
  let context: AudioContext | undefined;
  let frame = new Float32Array(0);
  let detector: Detector | undefined;
  // The string targets of the track and reference they were made for, so a frame recomputes none.
  let cachedTargets:
    { track: Track | undefined; referenceHz: number; set: StringSet | undefined } | undefined;
  let minHz = 30;
  let cancelTick: (() => void) | undefined;
  let cancelDevice: (() => void) | undefined;
  let cutoff = MAX_DETECT_HZ;
  // Bumped by every start and teardown, so a microphone request that returns late is dropped.
  let generation = 0;
  let trackKey = '';

  const store = create<TunerState>()((set, get) => {
    const targetsNow = () => {
      const track = trackOf(services);
      const { referenceHz: reference } = get();
      let cache = cachedTargets;
      if (!cache || cache.track !== track || cache.referenceHz !== reference) {
        cache = { track, referenceHz: reference, set: stringTargets(track, reference) };
        cachedTargets = cache;
      }
      return cache.set;
    };

    const teardown = () => {
      generation += 1;
      cancelTick?.();
      cancelTick = undefined;
      cancelDevice?.();
      cancelDevice = undefined;
      capture?.close();
      capture = undefined;
      detector = undefined;
      // A context made but never given to a capture (the microphone was refused).
      if (context) void context.close().catch(() => undefined);
      context = undefined;
      tracker.reset();
      cutoff = MAX_DETECT_HZ;
    };

    const fail = (error: TunerError) => {
      teardown();
      // Only a missing or lost device is worth retrying on its own, when one is plugged in.
      const keep = error.kind === 'noDevice' || error.kind === 'lost';
      set({ status: 'error', error, reading: undefined, autoString: undefined, wanted: keep });
    };

    const sizeFor = (sampleRate: number) => {
      const lowest = lowestTargetHz(targetsNow());
      minHz = lowest * FLAT_ALLOWANCE;
      const size = windowFor(sampleRate, lowest);
      tracker.setSettleFrames(settleFramesFor((size / sampleRate) * 1000));
      return size;
    };

    const tick = () => {
      if (!capture) return;
      capture.read(frame);
      const detection = detector?.detect(frame, capture.sampleRate, {
        minHz,
        maxHz: MAX_DETECT_HZ,
      });
      const step = tracker.push(detection, rms(frame), capture.clockMs(), now());
      if (step.cutoffHz !== cutoff) {
        cutoff = step.cutoffHz;
        capture.setCutoff(cutoff);
      }
      const state = get();
      const { reading } = step;
      if (!reading && !state.reading) return;
      const picking = reading && !reading.held && state.override === undefined;
      const auto = picking
        ? pickString(targetsNow()?.targets ?? [], reading.midi, state.autoString)?.string
        : reading
          ? state.autoString
          : undefined;
      set({ reading, autoString: auto });
    };

    const begin = async (onFailure: (error: unknown, from: 'microphone' | 'capture') => void) => {
      teardown();
      const mine = generation;
      set({ status: 'starting', error: undefined });
      // Made now, inside the user's click, before awaiting the microphone.
      let made: AudioContext;
      try {
        made = makeContext();
      } catch (error) {
        onFailure(error, 'capture');
        return;
      }
      context = made;
      let stream: MediaStream;
      try {
        stream = await platform.microphone();
      } catch (error) {
        if (mine === generation) onFailure(error, 'microphone');
        return;
      }
      if (mine !== generation) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      try {
        const size = sizeFor(made.sampleRate);
        const input = await open(stream, made, size);
        if (mine !== generation) {
          input.close();
          return;
        }
        capture = input;
        context = undefined;
        frame = new Float32Array(size);
        detector = createDetector(size);
        trackKey = trackSignature();
        input.onEnded(() => {
          if (mine !== generation) return;
          // A revoked permission is a refusal, not an unplugged device.
          void begin((error) => {
            const cause = micErrorOf(error);
            fail(cause.kind === 'noDevice' ? tunerError('lost') : cause);
          });
        });
        cancelTick = schedule.every(tick, HOP_MS);
        set({ status: 'listening', error: undefined });
      } catch (error) {
        for (const track of stream.getTracks()) track.stop();
        if (mine === generation) onFailure(error, 'capture');
      }
    };

    const trackSignature = () => {
      const track = trackOf(services);
      return `${document.getState().id ?? ''}|${track?.id ?? ''}|${track?.tuning.join(',') ?? ''}|${String(track?.capo ?? 0)}`;
    };

    const listen = () => {
      void begin((error, from) => {
        if (error instanceof ContextNotStartedError) {
          // Chromium would not start the context without a gesture: back to the invitation.
          teardown();
          set({ status: 'idle', error: undefined, reading: undefined, wanted: false });
          return;
        }
        // A failure of the audio graph is a bug to show as such, not a missing microphone.
        fail(from === 'microphone' ? micErrorOf(error) : failedError(error));
      });
    };

    // A new tuning or capo changes the lowest string, so the window and the lower limit follow.
    const onTrackChange = () => {
      const key = trackSignature();
      if (key === trackKey) return;
      const previous = trackKey.split('|');
      trackKey = key;
      const [documentId, trackId] = key.split('|');
      if (documentId !== previous[0] || trackId !== previous[1]) {
        set({ override: undefined, autoString: undefined });
      }
      if (!capture) return;
      const size = sizeFor(capture.sampleRate);
      if (size !== frame.length) {
        frame = new Float32Array(size);
        detector = createDetector(size);
        capture.setFrameSize(size);
      }
    };

    const onDeviceChange = () => {
      const { status, wanted } = get();
      if (!attached || !wanted) return;
      if (status === 'listening') {
        cancelDevice?.();
        cancelDevice = schedule.after(listen, DEVICE_CHANGE_DEBOUNCE_MS);
      } else if (status === 'error') {
        listen();
      }
    };

    return {
      status: 'idle',
      error: undefined,
      reading: undefined,
      referenceHz,
      override: undefined,
      autoString: undefined,
      wanted: false,

      start() {
        set({ wanted: true });
        if (attached) listen();
      },

      stop() {
        teardown();
        set({
          wanted: false,
          status: 'idle',
          error: undefined,
          reading: undefined,
          autoString: undefined,
        });
      },

      toggle() {
        const { wanted, status } = get();
        if (wanted && status !== 'error') get().stop();
        else get().start();
      },

      setReference(hz) {
        if (!isValidReference(hz)) return false;
        try {
          storage().setItem(REFERENCE_STORAGE_KEY, String(hz));
        } catch {
          // The reference still applies this session.
        }
        tracker.setReference(hz);
        set({ referenceHz: hz, reading: undefined, autoString: undefined });
        return true;
      },

      selectString(string) {
        set({ override: string });
      },

      attach() {
        attached = true;
        trackKey = trackSignature();
        const stopSelection = selection.subscribe(onTrackChange);
        const stopDocument = document.subscribe(onTrackChange);
        const onVisibility = () => {
          if (page.visibilityState === 'hidden') {
            teardown();
            if (get().status !== 'error')
              set({ status: 'idle', reading: undefined, autoString: undefined });
          } else if (get().wanted && !capture && get().status !== 'error') {
            listen();
          }
        };
        page.addEventListener('visibilitychange', onVisibility);
        const onDevices = () => {
          onDeviceChange();
        };
        mediaDevices?.addEventListener('devicechange', onDevices);
        if (get().wanted && page.visibilityState !== 'hidden') listen();
        return () => {
          attached = false;
          stopSelection();
          stopDocument();
          page.removeEventListener('visibilitychange', onVisibility);
          mediaDevices?.removeEventListener('devicechange', onDevices);
          teardown();
          set({ status: 'idle', error: undefined, reading: undefined, autoString: undefined });
        };
      },
    };
  });

  return store;
}

export type TunerStore = ReturnType<typeof createTuner>;
