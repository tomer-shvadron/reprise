/**
 * What the read check records about a file beyond whether it read: the features the owner's
 * listening sheet asks about, each with the first bars that carry it.
 */
import { percussionInstrument } from '@reprise/model';
import type { Score } from '@reprise/model';

import type { ListeningFeature } from './check-meta';

const FIRST_BARS = 5;

class FeatureSet {
  readonly #bars = new Map<string, Set<number>>();
  readonly #details = new Map<string, Set<string>>();

  add(key: string, barIndex: number, detail?: string): void {
    const bars = this.#bars.get(key) ?? new Set<number>();
    bars.add(barIndex + 1);
    this.#bars.set(key, bars);
    if (detail !== undefined) {
      const details = this.#details.get(key) ?? new Set<string>();
      details.add(detail);
      this.#details.set(key, details);
    }
  }

  list(): ListeningFeature[] {
    return [...this.#bars.entries()].map(([key, bars]) => {
      const details = this.#details.get(key);
      const feature: ListeningFeature = {
        key,
        bars: [...bars].sort((a, b) => a - b).slice(0, FIRST_BARS),
      };
      if (details)
        feature.detail = [...details]
          .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
          .join(', ');
      return feature;
    });
  }
}

/** Every feature key `listeningFeatures` can emit; `scripts/check-files/listening.ts` maps each. */
export const FEATURE_KEYS = [
  'tempo-change',
  'tempo-ramp',
  'repeats',
  'alternate-endings',
  'jumps',
  'time-signature-change',
  'key-change',
  'triplet-feel',
  'bends',
  'whammy',
  'vibrato',
  'slides',
  'hammer-ons',
  'harmonics',
  'trills',
  'grace-notes',
  'palm-mute',
  'let-ring',
  'dead-notes',
  'ghost-notes',
  'accents',
  'staccato',
  'dynamics',
  'tremolo-picking',
  'strokes',
  'tapping-slapping-popping',
  'fades',
  'ties',
  'multiple-voices',
  'drums',
  'pitched-non-fretted',
  'mixer-changes',
  'multiple-tracks',
  'muted-or-solo-tracks',
  'lyrics',
  'chord-diagrams',
] as const;

function structure(score: Score, found: FeatureSet): void {
  let bpm = score.masterBars[0]?.tempo?.bpm;
  score.masterBars.forEach((bar, i) => {
    if (bar.repeat.start || bar.repeat.endCount > 0) found.add('repeats', i);
    if (bar.alternateEndings.length > 0) found.add('alternate-endings', i);
    for (const jump of bar.jumps) found.add('jumps', i, jump.kind);
    for (const target of bar.targets) found.add('jumps', i, target);
    if (bar.tripletFeel !== 'none') found.add('triplet-feel', i, bar.tripletFeel);
    const previous = score.masterBars[i - 1];
    if (!previous) return;
    const [a, b] = [previous.timeSignature, bar.timeSignature];
    if (a.numerator !== b.numerator || a.denominator !== b.denominator) {
      found.add('time-signature-change', i);
    }
    const [k, l] = [previous.keySignature, bar.keySignature];
    if (k.fifths !== l.fifths || k.minor !== l.minor) found.add('key-change', i);
    if (bar.tempo && bar.tempo.bpm !== bpm) found.add('tempo-change', i);
    if (bar.tempo) bpm = bar.tempo.bpm;
  });
}

function tracks(score: Score, found: FeatureSet): void {
  if (score.tracks.length > 1) found.add('multiple-tracks', 0, String(score.tracks.length));
  for (const track of score.tracks) {
    if (track.kind === 'pitched') found.add('pitched-non-fretted', 0);
    if (track.channel.mute) found.add('muted-or-solo-tracks', 0, 'mute');
    if (track.channel.solo) found.add('muted-or-solo-tracks', 0, 'solo');
    if (track.lyrics.some((line) => line.text.trim() !== '')) {
      found.add('lyrics', track.lyrics.find((line) => line.text.trim() !== '')?.startBar ?? 0);
    }
  }
}

/** Walks the score once; bars are in written order. */
export function listeningFeatures(score: Score): ListeningFeature[] {
  const found = new FeatureSet();
  structure(score, found);
  tracks(score, found);
  const dynamics = new Set<string>();
  for (const track of score.tracks) {
    track.bars.forEach((bar, b) => {
      bar.voices.forEach((voice, v) => {
        for (const beat of voice.beats) {
          if (v > 0 && beat.notes.length > 0) found.add('multiple-voices', b);
          const { effects } = beat;
          if (beat.mix?.tempo) {
            found.add('tempo-change', b);
            if ((beat.mix.tempo.duration ?? 0) > 0) found.add('tempo-ramp', b);
          }
          if (beat.mix?.program !== undefined) found.add('mixer-changes', b, 'program');
          if (beat.mix?.volume) found.add('mixer-changes', b, 'volume');
          if (beat.mix?.pan) found.add('mixer-changes', b, 'pan');
          if (beat.chord?.diagram?.frets.some((fret) => fret !== null) === true) {
            found.add('chord-diagrams', b);
          }
          if (beat.lyrics?.some((line) => line.trim() !== '') === true) found.add('lyrics', b);
          if (beat.grace && beat.grace.length > 0) found.add('grace-notes', b);
          if (effects.whammy) found.add('whammy', b, effects.whammy.kind);
          if (effects.vibrato && effects.vibrato !== 'none') found.add('vibrato', b, 'beat');
          if (effects.tremoloPicking !== undefined) found.add('tremolo-picking', b);
          if (effects.brush) found.add('strokes', b, 'brush');
          if (effects.arpeggio) found.add('strokes', b, 'arpeggio');
          if (effects.tapping === true) found.add('tapping-slapping-popping', b, 'tapping');
          if (effects.slapping === true) found.add('tapping-slapping-popping', b, 'slapping');
          if (effects.popping === true) found.add('tapping-slapping-popping', b, 'popping');
          if (effects.fadeIn === true) found.add('fades', b, 'fadeIn');
          if (effects.fadeOut === true) found.add('fades', b, 'fadeOut');
          if (effects.volumeSwell === true) found.add('fades', b, 'volumeSwell');
          for (const note of beat.notes) {
            if (track.kind === 'drums') {
              const name = percussionInstrument(note.fret)?.name ?? 'unknown';
              found.add('drums', b, `${String(note.fret)} ${name}`);
            }
            if (note.bend) found.add('bends', b, note.bend.kind);
            if (note.vibrato !== 'none') found.add('vibrato', b, note.vibrato);
            for (const slide of note.slide ?? []) found.add('slides', b, slide);
            if (note.hammerPull) found.add('hammer-ons', b);
            if (note.harmonic) found.add('harmonics', b, note.harmonic.kind);
            if (note.trill) found.add('trills', b);
            if (note.palmMute) found.add('palm-mute', b);
            if (note.letRing) found.add('let-ring', b);
            if (note.dead) found.add('dead-notes', b);
            if (note.ghost) found.add('ghost-notes', b);
            if (note.accent !== 'none') found.add('accents', b, note.accent);
            if (note.staccato) found.add('staccato', b);
            if (note.tie) found.add('ties', b);
            dynamics.add(note.dynamics);
            if (dynamics.size > 1) found.add('dynamics', b, note.dynamics);
          }
        }
      });
    });
  }
  return found.list();
}
