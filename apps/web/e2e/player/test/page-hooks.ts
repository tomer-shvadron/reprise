/**
 * What the player flows install in the page before the app's modules run: a tap on the master
 * bus, a count of the AudioContexts made, File System Access pickers served from origin-private
 * storage, a log of completed writes, and probes that sample the page every animation frame.
 * `installPageHooks` is serialized into the page, so it may close over nothing.
 */

export type ReadoutField = 'bar' | 'beat' | 'time';

export interface FollowWatch {
  frames: number;
  outside: number;
  top: [number, number];
  left: [number, number];
  timedOut: boolean;
  /** The first frame that saw the line outside the score, for the failure message. */
  firstOutside?: { frame: number; bar: string; line: number[]; view: number[] };
}

export interface E2eProbe {
  /** Names the stubbed open picker returns, oldest first; empty means the user cancels. */
  picks: string[];
  saves: { suggestedName: string | undefined; types: unknown }[];
  /** Each completed `createWritable().close()`, with the file's size once closed. */
  writes: { name: string; size: number }[];
  contexts: AudioContext[];
  level(): { rms: number; peak: number; state: AudioContextState | 'none' };
  peakWhile(field: ReadoutField, text: string): Promise<number>;
  beatInterval(changes: number): Promise<number>;
  /** Every bar the readout shows until it has jumped from `from` back to `to` `times` times. */
  barTrail(from: string, to: string, times: number): Promise<{ bars: string[]; timedOut: boolean }>;
  watchFollow(untilBar: string): Promise<FollowWatch>;
}

declare global {
  interface Window {
    __e2e: E2eProbe;
  }
}

export function installPageHooks(): void {
  const GUARD_MS = 20_000;
  const contexts: AudioContext[] = [];
  const NativeContext = window.AudioContext;
  window.AudioContext = new Proxy(NativeContext, {
    construct(target, args: unknown[], newTarget: unknown) {
      const context: unknown = Reflect.construct(target, args, newTarget as never);
      if (context instanceof NativeContext) contexts.push(context);
      return context as object;
    },
  });

  // Each realtime context's destination is reached through a gain that also feeds an analyser.
  const taps = new WeakMap<BaseAudioContext, { gain: GainNode; analyser: AnalyserNode }>();
  const connect = Reflect.get(AudioNode.prototype, 'connect');
  const disconnect = Reflect.get(AudioNode.prototype, 'disconnect');
  const tapOf = (context: AudioContext) => {
    let tap = taps.get(context);
    if (!tap) {
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      Reflect.apply(connect, gain, [context.destination]);
      Reflect.apply(connect, gain, [analyser]);
      tap = { gain, analyser };
      taps.set(context, tap);
    }
    return tap;
  };
  const redirect = (target: unknown): unknown =>
    target instanceof AudioDestinationNode && target.context instanceof NativeContext
      ? tapOf(target.context).gain
      : target;
  Object.defineProperty(AudioNode.prototype, 'connect', {
    configurable: true,
    writable: true,
    value: function (this: AudioNode, target: unknown, ...rest: unknown[]): unknown {
      return Reflect.apply(connect, this, [redirect(target), ...rest]);
    },
  });
  Object.defineProperty(AudioNode.prototype, 'disconnect', {
    configurable: true,
    writable: true,
    value: function (this: AudioNode, ...args: unknown[]): unknown {
      const [target, ...rest] = args;
      return Reflect.apply(disconnect, this, args.length === 0 ? [] : [redirect(target), ...rest]);
    },
  });

  const samples = new Float32Array(2048);
  const level = () => {
    const context = contexts[0];
    const tap = context && taps.get(context);
    if (!context || !tap) return { rms: 0, peak: 0, state: context?.state ?? ('none' as const) };
    tap.analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    let peak = 0;
    for (const sample of samples) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return { rms: Math.sqrt(sum / samples.length), peak, state: context.state };
  };

  const picks: string[] = [];
  const saves: E2eProbe['saves'] = [];
  const writes: E2eProbe['writes'] = [];
  const root = () => navigator.storage.getDirectory();
  Object.defineProperty(window, 'showOpenFilePicker', {
    configurable: true,
    value: async () => {
      const name = picks.shift();
      if (name === undefined) throw new DOMException('The user aborted a request.', 'AbortError');
      return [await (await root()).getFileHandle(name)];
    },
  });
  Object.defineProperty(window, 'showSaveFilePicker', {
    configurable: true,
    value: async (options?: { suggestedName?: string; types?: unknown }) => {
      saves.push({ suggestedName: options?.suggestedName, types: options?.types });
      return (await root()).getFileHandle(options?.suggestedName ?? 'untitled', { create: true });
    },
  });
  // Reading a file before its writable has closed races the browser's swap file.
  const createWritable = Reflect.get(FileSystemFileHandle.prototype, 'createWritable');
  Object.defineProperty(FileSystemFileHandle.prototype, 'createWritable', {
    configurable: true,
    writable: true,
    value: async function (
      this: FileSystemFileHandle,
      ...args: unknown[]
    ): Promise<FileSystemWritableFileStream> {
      const stream = (await Reflect.apply(
        createWritable,
        this,
        args,
      )) as FileSystemWritableFileStream;
      const close = stream.close.bind(stream);
      Object.defineProperty(stream, 'close', {
        configurable: true,
        value: async () => {
          await close();
          writes.push({ name: this.name, size: (await this.getFile()).size });
        },
      });
      return stream;
    },
  });

  const field = (name: ReadoutField) =>
    document.querySelector(`[data-position-readout] [data-field="${name}"]`)?.textContent ?? '';

  /** Calls `step` every animation frame until it returns true or the guard runs out. */
  const everyFrame = (step: (time: number) => boolean): Promise<boolean> =>
    new Promise((resolve) => {
      const start = performance.now();
      const frame = (time: number) => {
        if (step(time)) resolve(false);
        else if (performance.now() - start > GUARD_MS) resolve(true);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

  const peakWhile = async (name: ReadoutField, text: string) => {
    let peak = 0;
    let seen = false;
    await everyFrame(() => {
      if (field(name) !== text) return seen;
      seen = true;
      peak = Math.max(peak, level().peak);
      return false;
    });
    return peak;
  };

  const beatInterval = async (changes: number) => {
    const times: number[] = [];
    let last = field('beat');
    await everyFrame((time) => {
      const beat = field('beat');
      if (beat !== last) {
        last = beat;
        times.push(time);
      }
      return times.length > changes;
    });
    const first = times[0];
    const final = times.at(-1);
    if (first === undefined || final === undefined || times.length < 2) return Number.NaN;
    return (final - first) / (times.length - 1);
  };

  const barTrail = async (from: string, to: string, times: number) => {
    const bars: string[] = [];
    let jumps = 0;
    const timedOut = await everyFrame(() => {
      const bar = field('bar');
      const previous = bars.at(-1);
      if (bar === previous) return false;
      if (previous === from && bar === to) jumps += 1;
      bars.push(bar);
      return jumps >= times;
    });
    return { bars, timedOut };
  };

  const watchFollow = async (untilBar: string): Promise<FollowWatch> => {
    const region = document.querySelector<HTMLElement>(
      '[role="region"][aria-roledescription="score"]',
    );
    const cursor = document.querySelector<HTMLElement>('[data-playhead] .score-cursor');
    const result: FollowWatch = {
      frames: 0,
      outside: 0,
      top: [Infinity, -Infinity],
      left: [Infinity, -Infinity],
      timedOut: true,
    };
    if (!region || !cursor) return result;
    result.timedOut = await everyFrame(() => {
      const view = region.getBoundingClientRect();
      const line = cursor.getBoundingClientRect();
      result.frames += 1;
      const inside =
        line.left >= view.left - 1 &&
        line.right <= view.right + 1 &&
        line.top >= view.top - 1 &&
        line.bottom <= view.bottom + 1;
      if (!inside) {
        result.outside += 1;
        result.firstOutside ??= {
          frame: result.frames,
          bar: field('bar'),
          line: [line.left, line.top, line.right, line.bottom],
          view: [view.left, view.top, view.right, view.bottom],
        };
      }
      result.top = [
        Math.min(result.top[0], region.scrollTop),
        Math.max(result.top[1], region.scrollTop),
      ];
      result.left = [
        Math.min(result.left[0], region.scrollLeft),
        Math.max(result.left[1], region.scrollLeft),
      ];
      return field('bar') === untilBar;
    });
    return result;
  };

  window.__e2e = {
    picks,
    saves,
    writes,
    contexts,
    level,
    peakWhile,
    beatInterval,
    barTrail,
    watchFollow,
  };
}
