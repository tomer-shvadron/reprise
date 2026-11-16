import { vi, type Mock } from 'vitest';

import { memoryStorage } from '@/test/services';

import type { TunerInput } from './capture';
import type { TunerDeps } from './tuner-store';

/** Test-only fakes for the tuner's outside world: a microphone, a capture, clocks and events. */

export class FakeTrack extends EventTarget {
  readonly stop: Mock<() => void> = vi.fn();
}

export class FakeStream {
  readonly track = new FakeTrack();
  getTracks = () => [this.track];
  getAudioTracks = () => [this.track];
}

export interface Rig {
  deps: TunerDeps;
  microphone: Mock<() => Promise<MediaStream>>;
  streams: FakeStream[];
  contexts: { close: Mock<() => Promise<void>> }[];
  captures: FakeCapture[];
  devices: EventTarget;
  page: EventTarget & { visibilityState: DocumentVisibilityState };
  storage: Storage;
  /** The pitch the fake capture hears, in Hz; undefined is silence. */
  hear: { hz: number | undefined; level: number; sampleRate: number };
  /** Runs `n` ticks of the 20 ms timer. */
  tick(n: number): void;
  /** Runs the pending one-shot timers. */
  elapse(ms: number): void;
}

export class FakeCapture implements TunerInput {
  sampleRate: number;
  frameSize: number;
  cutoff = 1500;
  closed = false;
  private readonly listeners: (() => void)[] = [];

  constructor(
    private readonly hear: Rig['hear'],
    frameSize: number,
    private readonly stream: FakeStream,
    private readonly context: { close: Mock<() => Promise<void>> },
  ) {
    this.sampleRate = hear.sampleRate;
    this.frameSize = frameSize;
  }

  read(into: Float32Array<ArrayBuffer>) {
    const { hz, level } = this.hear;
    for (let i = 0; i < into.length; i += 1) {
      into[i] = hz === undefined ? 0 : level * Math.sin((2 * Math.PI * hz * i) / this.sampleRate);
    }
  }

  setFrameSize(size: number) {
    this.frameSize = size;
  }

  setCutoff(hz: number) {
    this.cutoff = hz;
  }

  onEnded(listener: () => void) {
    this.listeners.push(listener);
  }

  end() {
    for (const listener of this.listeners) listener();
  }

  close() {
    this.closed = true;
    this.stream.track.stop();
    void this.context.close();
  }
}

/** A fake world for the store: the microphone yields fake streams, timers run by hand. */
export function createRig(): Rig {
  const devices = new EventTarget();
  const storage = memoryStorage();
  const streams: FakeStream[] = [];
  const contexts: Rig['contexts'] = [];
  const captures: FakeCapture[] = [];
  const hear: Rig['hear'] = { hz: 110 * 2 ** (12 / 1200), level: 0.3, sampleRate: 48000 };
  const intervals = new Set<() => void>();
  const timeouts = new Map<number, { run: () => void; at: number }>();
  let clock = 0;
  let nextTimeout = 0;
  const visible: DocumentVisibilityState = 'visible';
  const page = Object.assign(new EventTarget(), { visibilityState: visible });
  const microphone = vi.fn<() => Promise<MediaStream>>(() => {
    const stream = new FakeStream();
    streams.push(stream);
    // The fake carries only the members the store and capture use.
    return Promise.resolve(stream as unknown as MediaStream);
  });
  const deps: TunerDeps = {
    createContext: () => {
      const context = { close: vi.fn(() => Promise.resolve()) };
      contexts.push(context);
      return context as unknown as AudioContext;
    },
    openCapture: (stream, context, size) => {
      const capture = new FakeCapture(
        hear,
        size,
        stream as unknown as FakeStream,
        context as unknown as Rig['contexts'][number],
      );
      captures.push(capture);
      return Promise.resolve(capture);
    },
    storage: () => storage,
    mediaDevices: devices,
    schedule: {
      every(run) {
        intervals.add(run);
        return () => {
          intervals.delete(run);
        };
      },
      after(run, ms) {
        const id = nextTimeout;
        nextTimeout += 1;
        timeouts.set(id, { run, at: clock + ms });
        return () => {
          timeouts.delete(id);
        };
      },
    },
    now: () => clock,
    page,
  };
  return {
    deps,
    microphone,
    streams,
    contexts,
    captures,
    devices,
    page,
    storage,
    hear,
    tick(n) {
      for (let i = 0; i < n; i += 1) {
        clock += 20;
        for (const run of [...intervals]) run();
      }
    },
    elapse(ms) {
      clock += ms;
      for (const [id, timer] of [...timeouts]) {
        if (timer.at <= clock) {
          timeouts.delete(id);
          timer.run();
        }
      }
    },
  };
}
