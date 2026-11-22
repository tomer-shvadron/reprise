import { beatTicks, midiNote, soundingPitch } from '@reprise/model';
import type { BeatEffects, Note, PickScrape, Track } from '@reprise/model';

import type { FilterSettings } from '../sampler/voice';
import { ARTICULATION } from './parameters';
import type { SampledEffect } from './sets';
import { bendTerm, chainGain, tieChain, vibratoTerm, whammyTerm } from './tie-chain';
import type { PitchTerm, TieChain } from './tie-chain';
import { noteVelocity } from './velocity';

const NO_EFFECTS: ReadonlySet<SampledEffect> = new Set();

export type PlanTrack = Pick<Track, 'kind' | 'tuning' | 'capo'>;

/** A tied link folded into the note, timed in context seconds; the origin is one too, spanning its beat. */
export interface PlanLink {
  note: Note;
  /** The link's beat effects: whammy, vibrato and fades. */
  effects: BeatEffects;
  when: number;
  /** Seconds of the link's own beat. */
  length: number;
}

/** One note to voice: a scheduler event, or a grace note placed by the sink. */
export interface PlanInput {
  track: PlanTrack;
  note: Note;
  /** The beat's effects; a grace note has none of its own. */
  effects: BeatEffects;
  when: number;
  /** Seconds to the release, ties folded in. */
  length: number;
  /** Seconds of the note's own beat, which whammy and fades span. */
  beatLength: number;
  /** The tied notes folded into this one, in order; empty when it is not tied. */
  links: readonly PlanLink[];
  secondsPerTick: number;
  barEnd: number;
  /** The next note on the string; its beat's effects tell whether it is tapped. */
  next: { note: Note; when: number; effects?: BeatEffects } | undefined;
  /** The key of the voice a legato slide carries into this note, which then has no attack. */
  continues?: number;
  /**
   * The effects the set that plays the note already carries in its samples (`voicingOf`): their
   * synthesized automation is left out. Absent on General MIDI, where nothing is.
   */
  sampled?: ReadonlySet<SampledEffect>;
}

/**
 * A hammer-on, pull-off or tapped note: struck by the fretting hand, so no pick attack. Tapping
 * is a beat effect, not a note one, and sounds like a hammer-on (scope-v1, #255).
 */
export function isHammered(
  note: Pick<Note, 'hammerPull'>,
  effects: Pick<BeatEffects, 'tapping'>,
): boolean {
  return note.hammerPull || (effects.tapping ?? false);
}

/** One attack: a voice started at `when` and released at `end`. */
export interface Strike {
  key: number;
  /** Semitones added to the note's pitch curve: a harmonic's fraction or a legato's distance. */
  detune: number;
  velocity: number;
  when: number;
  end: number;
  offset?: number;
}

/** A level breakpoint; levels between breakpoints are linear in dB. */
export interface GainPoint {
  at: number;
  db: number;
}

export interface NotePlan {
  strikes: Strike[];
  /** The first strike is the voice a legato slide carried in, not a new one. */
  continues: boolean;
  /** A dead note with no sampled layer: a short filtered noise burst instead of the instrument. */
  dead: boolean;
  /**
   * A pick scrape: the strike is a noise sweep (key `SCRAPE_KEY`) that replaces the pitched note,
   * with `filter` and `filterChanges` as the bandpass sweep.
   */
  scrape: PickScrape | undefined;
  /** Semitones relative to each strike's pitch at an absolute time; absent when flat. */
  pitch: ((time: number) => number) | undefined;
  gain: GainPoint[];
  /** The onset filter. */
  filter: FilterSettings | undefined;
  /** Filter settings taking over later in the note, in time order: a palm-muted link. */
  filterChanges: { at: number; filter: FilterSettings }[];
  letRingUntil: number | undefined;
  /** The last strike's voice is not released: it carries into the next note, starting here. */
  legatoInto: number | undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Whether the last link is heard, even staccato: only its slide aims past the chain. */
function reachesLastLink(input: PlanInput, chain: TieChain): boolean {
  return chain.segments.length === input.links.length + 1;
}

function slideTerms(input: PlanInput, key: number, chain: TieChain): PitchTerm[] {
  const { note, when, next, track } = input;
  const { end, segments } = chain;
  const terms: PitchTerm[] = [];
  const interval = ARTICULATION.slideInterval;
  const last = segments.at(-1) ?? { note, when };
  if (note.slide?.includes('intoFromBelow') || note.slide?.includes('intoFromAbove')) {
    const window = Math.min(ARTICULATION.slideInOutTime, (end - when) / 3);
    for (const kind of note.slide) {
      if (kind !== 'intoFromBelow' && kind !== 'intoFromAbove') continue;
      const from = kind === 'intoFromBelow' ? -interval : interval;
      terms.push((time) => from * (1 - clamp01((time - when) / window)));
    }
  }
  const out = [...segments]
    .reverse()
    .find((segment) => segment.note.slide?.some((kind) => kind === 'outDown' || kind === 'outUp'));
  if (out) {
    const window = Math.min(ARTICULATION.slideInOutTime, (end - last.when) / 3);
    const start = end - window;
    for (const kind of out.note.slide ?? []) {
      if (kind !== 'outDown' && kind !== 'outUp') continue;
      const to = kind === 'outDown' ? -interval : interval;
      terms.push((time) => to * clamp01((time - start) / window));
    }
  }
  const glides = last.note.slide?.includes('legato') || last.note.slide?.includes('shift');
  if (glides && next && reachesLastLink(input, chain)) {
    const target = soundingPitch(track, next.note) - key;
    const arrive = Math.min(end, next.when);
    const glide = Math.min(
      ARTICULATION.slideFraction * (arrive - last.when),
      ARTICULATION.slideMaxGlide,
    );
    const start = arrive - glide;
    terms.push((time) => (glide > 0 ? target * clamp01((time - start) / glide) : 0));
  }
  return terms;
}

function pitchTerms(input: PlanInput, key: number, chain: TieChain): PitchTerm[] {
  const { segments } = chain;
  const terms = [bendTerm(segments, chain.end), whammyTerm(segments), vibratoTerm(segments)].filter(
    (term): term is PitchTerm => term !== undefined,
  );
  terms.push(...slideTerms(input, key, chain));
  return terms;
}

/**
 * The effect decides first (dead, then palm mute, then harmonic), and a sampled one then leaves
 * no filter: a palm-muted harmonic with only the palm mute sampled does not take the shelf.
 */
function filterFor(note: Note, sampled: ReadonlySet<SampledEffect>): FilterSettings | undefined {
  if (note.dead) {
    return sampled.has('dead')
      ? undefined
      : { type: 'lowpass', frequency: ARTICULATION.dead.cutoff };
  }
  if (note.palmMute) {
    return sampled.has('palmMute')
      ? undefined
      : { type: 'lowpass', frequency: ARTICULATION.palmMute.cutoff };
  }
  if (note.harmonic) {
    if (sampled.has('harmonic')) return undefined;
    const { shelfFrequency, shelfGain } = ARTICULATION.harmonic;
    return { type: 'highshelf', frequency: shelfFrequency, gain: shelfGain };
  }
  return undefined;
}

/**
 * A palm-muted link damps an open string from its onset; a sampled palm-muted origin is already
 * damped by its layer, so a link there adds nothing.
 */
function linkFilters(
  chain: TieChain,
  sampled: ReadonlySet<SampledEffect>,
): NotePlan['filterChanges'] {
  if (sampled.has('palmMute') && chain.segments[0]?.note.palmMute) return [];
  const muted = chain.segments.slice(1).find((link) => link.note.palmMute);
  if (!muted) return [];
  return [{ at: muted.when, filter: { type: 'lowpass', frequency: ARTICULATION.palmMute.cutoff } }];
}

/** Retriggers every `step` seconds across the note; a remainder is a shorter last stroke. */
function retriggers(when: number, end: number, step: number): { when: number; end: number }[] {
  if (!(step > 0)) return [{ when, end }];
  const count = Math.max(1, Math.ceil((end - when) / step - 1e-6));
  return Array.from({ length: count }, (_, index) => ({
    when: when + index * step,
    end: Math.min(end, when + (index + 1) * step),
  }));
}

/**
 * A scrape replaces the strike: one noise sweep over the note, ties folded in, capped. It is
 * a picking-hand noise, so no pitch articulation, course, ring or slide applies to it.
 */
function planScrape(input: PlanInput, scrape: PickScrape): NotePlan {
  const { when } = input;
  const { key, maxLength, from, to, q, step } = ARTICULATION.pickScrape;
  const end = when + Math.min(input.length, maxLength);
  const span = end - when;
  // White noise has no spectrum to detune, so the sweep is the bandpass itself, geometric in
  // frequency: an octave of travel takes the same time wherever it is.
  const [start, finish] = scrape === 'down' ? [from, to] : [to, from];
  const at = (time: number): number =>
    start * (finish / start) ** (span > 0 ? clamp01((time - when) / span) : 0);
  const filterChanges: NotePlan['filterChanges'] = [];
  for (let time = when + step; time < end - 1e-9; time += step) {
    filterChanges.push({ at: time, filter: { type: 'bandpass', frequency: at(time), q } });
  }
  return {
    strikes: [{ key, detune: 0, velocity: noteVelocity(input.note), when, end }],
    continues: false,
    dead: false,
    scrape,
    pitch: undefined,
    gain: [],
    filter: { type: 'bandpass', frequency: start, q },
    filterChanges,
    letRingUntil: undefined,
    legatoInto: undefined,
  };
}

/**
 * How one note sounds: its attacks, pitch curve, level shape, filter and release. Pure, so the
 * mapping is testable without rendering. Drum tracks take only velocity, fades and retriggers;
 * pitch, filter and length articulations are a string instrument's.
 */
export function planNote(input: PlanInput): NotePlan {
  const { track, note, effects, when } = input;
  const tonal = track.kind !== 'drums';
  const sampled = input.sampled ?? NO_EFFECTS;
  // Before the dead check: Guitar Pro marks a pick slide on a muted (x) note, and the scrape replaces it.
  if (tonal && note.pickScrape) return planScrape(input, note.pickScrape);
  const key = soundingPitch(track, note);
  const rounded = Math.round(key);
  // A dead note is short and has no pitch shape either way; only without a layer is it a burst.
  const dead = tonal && note.dead;
  const continues = input.continues;

  let end = when + input.length;
  // Guitar Pro shortens a staccato note to half its own beat, ties ignored.
  if (tonal && note.staccato) {
    end = when + Math.min(input.length, input.beatLength) * ARTICULATION.staccatoFraction;
  }
  // A sampled mute has its own decay, so it is let go later than the noise burst.
  if (dead) {
    const limit = sampled.has('dead') ? ARTICULATION.dead.sampledLength : ARTICULATION.dead.length;
    end = Math.min(end, when + limit);
  }
  const chain = tieChain(input, tonal, end);
  end = chain.end;
  const last = chain.segments.at(-1)?.note ?? note;

  const legato =
    tonal &&
    !dead &&
    input.next !== undefined &&
    reachesLastLink(input, chain) &&
    last.slide?.includes('legato');
  const legatoInto = legato ? input.next?.when : undefined;

  const velocity = noteVelocity(note);
  const hammered = isHammered(note, effects);
  const softened = noteVelocity(note, { hammer: true });
  const base: Strike = {
    key: continues ?? rounded,
    detune: key - (continues ?? rounded),
    velocity: hammered ? softened : velocity,
    when,
    end,
    // A legato layer carries its own onset, so the 20 ms of a synthesized one is dropped.
    ...(hammered && !sampled.has('legato') && { offset: ARTICULATION.hammerOffset }),
  };

  let strikes: Strike[] = [base];
  if (note.trill && !dead) {
    const step = beatTicks({ duration: note.trill.speed, dots: 0 }) * input.secondsPerTick;
    const other = midiNote(track, { string: note.string, fret: note.trill.fret });
    strikes = retriggers(when, end, step).map((span, index) => {
      if (index === 0) return { ...base, end: span.end };
      return {
        key: index % 2 === 1 ? other : rounded,
        detune: index % 2 === 1 ? 0 : key - rounded,
        velocity: softened,
        offset: ARTICULATION.hammerOffset,
        ...span,
      };
    });
  } else if (effects.tremoloPicking && !dead) {
    const step = beatTicks({ duration: effects.tremoloPicking, dots: 0 }) * input.secondsPerTick;
    strikes = retriggers(when, end, step).map((span, index) => {
      if (index === 0) return { ...base, end: span.end };
      return { key: rounded, detune: key - rounded, velocity, ...span };
    });
  }

  const filter = tonal ? filterFor(note, sampled) : undefined;
  const terms = tonal && !dead ? pitchTerms(input, key, chain) : [];
  const pitch =
    terms.length > 0
      ? (time: number): number => terms.reduce((sum, term) => sum + term(time), 0)
      : undefined;

  return {
    strikes,
    continues: continues !== undefined,
    dead: dead && !sampled.has('dead'),
    scrape: undefined,
    pitch,
    gain: chainGain(chain.segments, tonal, sampled.has('palmMute')),
    filter,
    filterChanges: tonal && !dead && filter === undefined ? linkFilters(chain, sampled) : [],
    letRingUntil:
      tonal && note.letRing && legatoInto === undefined && !chain.cut
        ? Math.max(input.barEnd, end)
        : undefined,
    legatoInto,
  };
}
