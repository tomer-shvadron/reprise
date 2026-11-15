import { MAX_DETECT_HZ } from './strings';

/**
 * The only file that touches Web Audio: the microphone through two lowpass sections into an
 * analyser, read a window at a time. The mic is never connected to the destination.
 */

export interface TunerInput {
  sampleRate: number;
  /** Fills `into` (its length is the frame size) with the latest filtered samples. */
  read(into: Float32Array<ArrayBuffer>): void;
  setFrameSize(size: number): void;
  setCutoff(hz: number): void;
  /** Calls `listener` when the device goes away or its permission is revoked. */
  onEnded(listener: () => void): void;
  /** Stops the tracks, tears the graph down and closes the context. */
  close(): void;
}

/** Web Audio's lowpass `Q` is in dB: a Butterworth section is 20·log10(1/√2). */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);
const CUTOFF_SMOOTHING_S = 0.02;

/**
 * Made synchronously inside the click that starts listening, so the user activation lets it run.
 * Where the engine can route to no output at all (`sinkId: { type: 'none' }`) it does.
 */
export function createCaptureContext(): AudioContext {
  const options: AudioContextOptions & { sinkId?: { type: 'none' } } = {
    latencyHint: 'interactive',
  };
  if ('setSinkId' in AudioContext.prototype) options.sinkId = { type: 'none' };
  return new AudioContext(options);
}

export async function openCapture(
  stream: MediaStream,
  context: AudioContext,
  frameSize: number,
): Promise<TunerInput> {
  const source = context.createMediaStreamSource(stream);
  const filters = [context.createBiquadFilter(), context.createBiquadFilter()];
  for (const filter of filters) {
    filter.type = 'lowpass';
    filter.frequency.value = MAX_DETECT_HZ;
    filter.Q.value = BUTTERWORTH_Q_DB;
  }
  const analyser = context.createAnalyser();
  analyser.fftSize = frameSize;
  const [first, second] = filters;
  if (!first || !second) throw new Error('no filters');
  source.connect(first);
  first.connect(second);
  second.connect(analyser);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const track of stream.getTracks()) track.stop();
    source.disconnect();
    first.disconnect();
    second.disconnect();
    analyser.disconnect();
    void context.close().catch(() => undefined);
  };

  if (context.state === 'suspended') {
    try {
      await context.resume();
    } catch (error) {
      close();
      throw error;
    }
  }

  return {
    sampleRate: context.sampleRate,
    read: (into) => {
      analyser.getFloatTimeDomainData(into);
    },
    setFrameSize: (size) => {
      analyser.fftSize = size;
    },
    setCutoff: (hz) => {
      for (const filter of filters) {
        filter.frequency.setTargetAtTime(hz, context.currentTime, CUTOFF_SMOOTHING_S);
      }
    },
    onEnded: (listener) => {
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', listener);
    },
    close,
  };
}
