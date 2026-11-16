import { cabinetImpulse, roomImpulse } from './impulses';
import type { CabinetId } from './impulses';

/**
 * The generated impulse responses as `AudioBuffer`s, made on first use and kept for the context:
 * about 0.5 MB for the room and 24 KB a cabinet at 44.1 kHz, under 2 MB for all of them at 48 kHz.
 */
export class ImpulseBank {
  readonly #context: BaseAudioContext;
  readonly #cabinets = new Map<CabinetId, AudioBuffer>();
  #room: AudioBuffer | undefined;

  constructor(context: BaseAudioContext) {
    this.#context = context;
  }

  cabinet(id: CabinetId): AudioBuffer {
    let buffer = this.#cabinets.get(id);
    if (!buffer) {
      buffer = this.#buffer([cabinetImpulse(id, this.#context.sampleRate)]);
      this.#cabinets.set(id, buffer);
    }
    return buffer;
  }

  room(): AudioBuffer {
    this.#room ??= this.#buffer(roomImpulse(this.#context.sampleRate));
    return this.#room;
  }

  /** Bytes held so far. */
  get bytes(): number {
    let bytes = this.#room ? this.#room.length * this.#room.numberOfChannels * 4 : 0;
    for (const buffer of this.#cabinets.values()) bytes += buffer.length * 4;
    return bytes;
  }

  #buffer(channels: Float32Array<ArrayBuffer>[]): AudioBuffer {
    const [first] = channels;
    const buffer = this.#context.createBuffer(
      channels.length,
      first?.length ?? 1,
      this.#context.sampleRate,
    );
    for (const [index, data] of channels.entries()) buffer.copyToChannel(data, index);
    return buffer;
  }
}

/**
 * One convolution reverb per song, shared: each strip sends to `input` after its fader and pan,
 * and the return joins `destination` (the master bus). A convolver per track would multiply the
 * one long convolution the effects cost by the track count.
 */
export class ReverbBus {
  readonly input: GainNode;
  readonly convolver: ConvolverNode;
  readonly #return: GainNode;

  constructor(context: BaseAudioContext, impulses: ImpulseBank, destination: AudioNode) {
    this.input = context.createGain();
    this.convolver = context.createConvolver();
    this.convolver.normalize = false;
    this.convolver.buffer = impulses.room();
    this.#return = context.createGain();
    this.input.connect(this.convolver).connect(this.#return).connect(destination);
  }

  dispose(): void {
    this.input.disconnect();
    this.convolver.disconnect();
    this.#return.disconnect();
  }
}
