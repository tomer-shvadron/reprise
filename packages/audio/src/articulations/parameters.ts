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
  dead: { length: 0.08, cutoff: 2500 },

  staccatoFraction: 0.5,
  /** Where fade-in, fade-out and volume swell start or end. */
  fadeFloor: -48,
} as const;
