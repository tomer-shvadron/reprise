import type { Dynamics, Vibrato } from '@reprise/model';

/** Guitar Pro's dynamics ladder: one step of 16 per mark, `fff` at the top. */
export const DYNAMICS_VELOCITY: Readonly<Record<Dynamics, number>> = {
  ppp: 15,
  pp: 31,
  p: 47,
  mp: 63,
  mf: 79,
  f: 95,
  ff: 111,
  fff: 127,
};

export const VELOCITY_STEP = 16;

/**
 * Every tuning constant of the GM-tier articulation layer in one place, so the README table and
 * the code cannot disagree. Times are seconds, pitches semitones, levels dB.
 */
export const ARTICULATION = {
  accentSteps: 1,
  heavyAccentSteps: 2,
  ghostSteps: -2,
  /** Hammer-ons, pull-offs and the trill's alternations after the first. */
  hammerSteps: -1,
  /** Into the sample: past the pick transient a fretting finger does not make. */
  hammerOffset: 0.02,

  /** Resolution of the sampled detune curve. */
  curveStep: 0.002,

  /** Shift and legato slides glide over this share of the note, at most `slideMaxGlide`. */
  slideFraction: 0.25,
  slideMaxGlide: 0.2,
  /** Slides in and out: from or to this far away, over `slideInOutTime` (at most a third of the note). */
  slideInterval: 3,
  slideInOutTime: 0.08,

  vibrato: {
    slight: { rate: 5.5, depth: 0.25 },
    wide: { rate: 5, depth: 0.6 },
  } satisfies Record<Exclude<Vibrato, 'none'>, { rate: number; depth: number }>,

  palmMute: { cutoff: 900, decayTo: -18, decayTime: 0.25 },
  harmonic: { shelfFrequency: 2000, shelfGain: 6 },
  dead: { length: 0.08, sampledLength: 0.25, cutoff: 2500 },

  /**
   * A picking-hand scrape replaces the note: white noise through a bandpass whose centre sweeps
   * from `from` to `to` Hz (reversed for an up scrape), moved every `step` seconds, at most
   * `maxLength` long.
   */
  pickScrape: {
    /** The key the noise region is rooted at; the noise is not detuned. */
    key: 60,
    maxLength: 1,
    from: 3000,
    to: 800,
    q: 2,
    step: 0.01,
    attack: 0.01,
    release: 0.05,
    /** The noise buffer's length, at least `maxLength`. */
    bufferLength: 1.1,
  },
  /**
   * A golpe is a synthesized body hit: a sine gliding from `frequency` to `endFrequency` over its
   * `decay`, plus a short low-passed noise burst. The thumb is the lower, rounder one.
   */
  golpe: {
    thumb: { frequency: 90, endFrequency: 55, decay: 0.16, noiseCutoff: 400, noiseLength: 0.03 },
    finger: {
      frequency: 160,
      endFrequency: 120,
      decay: 0.08,
      noiseCutoff: 3000,
      noiseLength: 0.015,
    },
    /** Level of the noise burst against the sine. */
    noiseAmplitude: 0.3,
    /** When the voice is released after the hit. */
    length: 0.4,
    /** The velocity of a hit on a beat with no notes. */
    restVelocity: DYNAMICS_VELOCITY.mf,
  },

  /**
   * The wah pedal (`effects/wah.ts`): a band-pass swept between two centre frequencies, closed
   * (heel down, dark) and open (toe down, bright). Reprise's own playback of the o and + marks:
   * Guitar Pro 8 treats them as notation only.
   */
  wah: {
    /** Centre frequency in Hz with the pedal closed (+). */
    closed: 400,
    /** Centre frequency in Hz with the pedal open (o). */
    open: 2200,
    q: 4,
    /** Time constant of the glide between two marks, in seconds: 95% of the way in 3x this. */
    glide: 0.04,
    /**
     * Gain after the band-pass, so a 110 Hz sawtooth swept to 940 Hz (the geometric middle of the
     * sweep) keeps its level to within 1.6 dB: the filter alone leaves about -15.6 dB of it.
     */
    makeup: 5,
  },

  staccatoFraction: 0.5,
  /** Where fade-in, fade-out and volume swell start or end. */
  fadeFloor: -48,
} as const;
