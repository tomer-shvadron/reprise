import { beatTicks, type Bar, type Beat, type Note, type Vibrato } from '@reprise/model';

import { glyphMetrics, textExtent, textWidth, type GlyphName } from '../../metrics';
import { LANE_HEIGHT, type LaneRequests } from '../lanes';
import { HARMONIC_LABELS } from './labels';

const TICK_EPSILON = 1e-6;

/** Effect text in the lanes, and the whammy's smaller text, in staff spaces. */
export const EFFECT_TEXT = 1;
export const WHAMMY_TEXT = 0.9;
/** Room kept either side of an item centred on an onset, beyond its own width, in staff spaces. */
const ITEM_SIDE = 0.2;
/** Gaps in a stack of articulations and around it, in staff spaces. */
const STACK_GAP = 0.25;
const STACK_MARGIN = 0.4;
const STROKE_MARGIN = 0.5;

/** Lanes whose items join into runs across consecutive beats. */
export type RunLane =
  'palmMute' | 'letRing' | 'harmonic' | 'vibrato' | 'beatVibrato' | 'trill' | 'whammy';

/** Beats in a row carrying one effect, merged across voices on the onset grid. */
export interface Run {
  lane: RunLane;
  /** Runs of one lane only join when their keys match: the harmonic kind, else the lane. */
  key: string;
  start: number;
  end: number;
  /** The onset of the run's last beat. */
  last: number;
  /** The widest wave in the run, for the vibrato lanes. */
  width: Exclude<Vibrato, 'none'>;
  beat: Beat;
}

/** Lanes that hold one item per onset. */
export type ItemLane = 'articulation' | 'pickStroke' | 'fade' | 'tap';

export interface LaneItem {
  lane: ItemLane;
  tick: number;
  beat: Beat;
  /** Glyphs bottom to top, or a text. */
  glyphs: GlyphName[];
  text?: string;
}

export interface BarRuns {
  runs: Run[];
  /** Where the bar's content ends: its longest voice. */
  end: number;
}

function playedNotes(beat: Beat): readonly Note[] {
  return beat.rest ? [] : beat.notes;
}

function runKey(lane: RunLane, beat: Beat): string | undefined {
  const notes = playedNotes(beat);
  if (notes.length === 0) return undefined;
  switch (lane) {
    case 'palmMute':
      return notes.some((note) => note.palmMute) ? lane : undefined;
    case 'letRing':
      return notes.some((note) => note.letRing) ? lane : undefined;
    case 'harmonic':
      return [...notes].sort((a, b) => a.string - b.string).find((note) => note.harmonic)?.harmonic
        ?.kind;
    case 'vibrato':
      return notes.some((note) => note.vibrato !== 'none') ? lane : undefined;
    case 'beatVibrato':
      return (beat.effects.vibrato ?? 'none') !== 'none' ? lane : undefined;
    case 'trill':
      return notes.some((note) => note.trill) ? lane : undefined;
    case 'whammy':
      return beat.effects.whammy ? lane : undefined;
  }
}

function waveWidth(lane: RunLane, beat: Beat): Exclude<Vibrato, 'none'> {
  if (lane === 'beatVibrato') return beat.effects.vibrato === 'wide' ? 'wide' : 'slight';
  return playedNotes(beat).some((note) => note.vibrato === 'wide') ? 'wide' : 'slight';
}

const RUN_LANES: readonly RunLane[] = [
  'palmMute',
  'letRing',
  'harmonic',
  'vibrato',
  'beatVibrato',
  'trill',
  'whammy',
];

interface Timed {
  beat: Beat;
  voice: number;
  tick: number;
  ticks: number;
}

function timedBeats(bar: Bar): Timed[] {
  const out: Timed[] = [];
  for (const [voice, { beats }] of bar.voices.entries()) {
    let tick = 0;
    for (const beat of beats) {
      const ticks = beatTicks(beat);
      out.push({ beat, voice, tick, ticks });
      tick += ticks;
    }
  }
  return out.sort((a, b) => a.tick - b.tick || a.voice - b.voice);
}

const runsMemo = new WeakMap<Bar, BarRuns>();

/** The bar's runs per lane; reads the bar alone, and never the space, so neighbours share it. */
export function barRuns(bar: Bar): BarRuns {
  const known = runsMemo.get(bar);
  if (known) return known;
  const timed = timedBeats(bar);
  let end = 0;
  for (const { tick, ticks } of timed) end = Math.max(end, tick + ticks);
  const runs: Run[] = [];
  for (const lane of RUN_LANES) {
    const open = new Map<string, Run>();
    for (const { beat, tick, ticks } of timed) {
      const key = runKey(lane, beat);
      if (key === undefined) continue;
      const width = waveWidth(lane, beat);
      const current = open.get(key);
      if (current && tick <= current.end + TICK_EPSILON) {
        current.end = Math.max(current.end, tick + ticks);
        current.last = Math.max(current.last, tick);
        if (width === 'wide') current.width = 'wide';
        continue;
      }
      const run: Run = { lane, key, start: tick, end: tick + ticks, last: tick, width, beat };
      open.set(key, run);
      runs.push(run);
    }
  }
  const result = { runs, end };
  runsMemo.set(bar, result);
  return result;
}

const LABELS: Partial<Record<RunLane, string>> = {
  palmMute: 'P.M.',
  letRing: 'let ring',
  whammy: 'w/bar',
};

const HARMONIC_BY_KEY: Partial<Record<string, string>> = HARMONIC_LABELS;

/** The text a run is labelled with, or undefined for the waves and the trill's glyph. */
export function runLabel(run: Run): string | undefined {
  if (run.lane === 'harmonic') return HARMONIC_BY_KEY[run.key];
  return LABELS[run.lane];
}

/** Whether `a` and `b` are the same run continued over a bar line. */
export function sameRun(a: Run, b: Run): boolean {
  return a.lane === b.lane && a.key === b.key;
}

function articulation(notes: readonly Note[]): GlyphName[] {
  const glyphs: GlyphName[] = [];
  if (notes.some((note) => note.staccato)) glyphs.push('articStaccatoAbove');
  if (notes.some((note) => note.accent === 'heavy')) glyphs.push('articMarcatoAbove');
  else if (notes.some((note) => note.accent === 'accent')) glyphs.push('articAccentAbove');
  return glyphs;
}

function fade(beat: Beat): GlyphName | undefined {
  const { effects } = beat;
  if (effects.fadeIn) return 'guitarFadeIn';
  if (effects.fadeOut) return 'guitarFadeOut';
  if (effects.volumeSwell) return 'guitarVolumeSwell';
  return undefined;
}

function tap(beat: Beat): string | undefined {
  const { effects } = beat;
  if (effects.tapping) return 'T';
  if (effects.slapping) return 'S';
  if (effects.popping) return 'P';
  return undefined;
}

export interface EffectOptions {
  /** Whether this staff draws the articulation lane: the tab only when it is the only staff. */
  articulations: boolean;
}

export interface BarEffects extends BarRuns {
  items: LaneItem[];
  /** Beats carrying a whammy, each with its onset and where its graph ends. */
  whammies: { beat: Beat; tick: number; next: number | undefined }[];
  lanes: LaneRequests;
  /** Room each onset needs for what is centred on it in a lane, in px. */
  reserved: { tick: number; left: number; right: number }[];
}

function hasBend(note: Note): boolean {
  return note.bend?.points.some((p) => p.value !== 0) ?? false;
}

export function glyphHeight(name: GlyphName): number {
  const { bbox } = glyphMetrics(name);
  return bbox.top - bbox.bottom;
}

export function glyphSpan(name: GlyphName): number {
  const { bbox } = glyphMetrics(name);
  return bbox.right - bbox.left;
}

const effectsMemo = new WeakMap<Bar, Map<string, BarEffects>>();

/**
 * What a bar draws in its effect lanes and how much room it needs: items per onset, runs, the
 * whammy graphs, lane heights and the onsets' reservations. Reads the bar alone, so a measurement
 * made from it stays true; memoised per `Bar`.
 */
export function analyseEffects(bar: Bar, space: number, options: EffectOptions): BarEffects {
  const key = `${String(space)} ${options.articulations ? 'a' : ''}`;
  const known = effectsMemo.get(bar)?.get(key);
  if (known) return known;

  const { runs, end } = barRuns(bar);
  const timed = timedBeats(bar);
  const items: LaneItem[] = [];
  const lanes: LaneRequests = {};
  const reserved: BarEffects['reserved'] = [];
  const raise = (lane: keyof LaneRequests, height: number): void => {
    lanes[lane] = Math.max(lanes[lane] ?? 0, height * space);
  };
  const reserve = (tick: number, left: number, right: number): void => {
    reserved.push({ tick, left: left * space, right: right * space });
  };
  const centred = (tick: number, width: number): void => {
    reserve(tick, width / 2 + ITEM_SIDE, width / 2 + ITEM_SIDE);
  };
  const textSpan = (content: string, size: number): number =>
    textWidth(content, size * space) / space;

  const byOnset = new Map<number, Timed[]>();
  for (const entry of timed) {
    const tick = Math.round(entry.tick * 1000);
    const list = byOnset.get(tick);
    if (list) list.push(entry);
    else byOnset.set(tick, [entry]);
  }
  for (const group of byOnset.values()) {
    const first = group[0];
    if (!first) continue;
    const { tick } = first;
    const notes = group.flatMap(({ beat }) => playedNotes(beat));
    if (notes.length === 0) continue;
    const played = group.filter(({ beat }) => playedNotes(beat).length > 0);
    const glyphs = options.articulations ? articulation(notes) : [];
    if (glyphs.length > 0) {
      items.push({ lane: 'articulation', tick, beat: first.beat, glyphs });
      const height = glyphs.reduce((sum, name) => sum + glyphHeight(name), 0);
      raise('articulation', height + STACK_GAP * (glyphs.length - 1) + STACK_MARGIN);
      centred(tick, Math.max(...glyphs.map(glyphSpan)));
    }
    const stroke = played.find(({ beat }) => beat.effects.pickStroke);
    if (stroke) {
      const name = stroke.beat.effects.pickStroke === 'up' ? 'stringsUpBow' : 'stringsDownBow';
      items.push({ lane: 'pickStroke', tick, beat: stroke.beat, glyphs: [name] });
      raise('pickStroke', glyphHeight(name) + STROKE_MARGIN);
      centred(tick, glyphSpan(name));
    }
    const faded = played.find(({ beat }) => fade(beat));
    const fadeGlyph = faded && fade(faded.beat);
    if (faded && fadeGlyph) {
      items.push({ lane: 'fade', tick, beat: faded.beat, glyphs: [fadeGlyph] });
      raise('fade', LANE_HEIGHT.fade);
      centred(tick, glyphSpan(fadeGlyph));
    }
    const tapped = played.find(({ beat }) => tap(beat));
    const letter = tapped && tap(tapped.beat);
    if (tapped && letter) {
      items.push({ lane: 'tap', tick, beat: tapped.beat, glyphs: [], text: letter });
      raise('tap', LANE_HEIGHT.tap);
      centred(tick, textSpan(letter, EFFECT_TEXT));
    }
    if (notes.some(hasBend)) raise('bend', LANE_HEIGHT.bend);
  }
  for (const { beat } of timed) {
    if (beat.grace?.some((grace) => grace.notes.some(hasBend))) raise('bend', LANE_HEIGHT.bend);
  }

  for (const run of runs) {
    switch (run.lane) {
      case 'vibrato':
        raise('vibrato', LANE_HEIGHT.vibrato[run.width]);
        break;
      case 'beatVibrato':
        raise('beatVibrato', LANE_HEIGHT.beatVibrato[run.width]);
        break;
      case 'trill':
        raise('trill', LANE_HEIGHT.trill);
        centred(run.start, glyphSpan('ornamentTrill'));
        break;
      case 'whammy': {
        raise('whammy', LANE_HEIGHT.whammy);
        reserve(run.start, 0, textSpan('w/bar', WHAMMY_TEXT) + ITEM_SIDE);
        break;
      }
      default: {
        raise(run.lane, LANE_HEIGHT.run);
        const label = runLabel(run);
        if (label) centred(run.start, textSpan(label, EFFECT_TEXT));
      }
    }
  }

  const whammies: BarEffects['whammies'] = [];
  for (const { beats } of bar.voices) {
    let tick = 0;
    for (const [i, beat] of beats.entries()) {
      const after = tick + beatTicks(beat);
      if (beat.effects.whammy && !beat.rest) {
        whammies.push({ beat, tick, next: i + 1 < beats.length ? after : undefined });
      }
      tick = after;
    }
  }

  const result: BarEffects = { runs, end, items, whammies, lanes, reserved };
  let byKey = effectsMemo.get(bar);
  if (!byKey) {
    byKey = new Map();
    effectsMemo.set(bar, byKey);
  }
  byKey.set(key, result);
  return result;
}

/** Cap height of effect text at `size` staff spaces, in px. */
export function capHeight(size: number, space: number): number {
  return textExtent(size * space).ascent;
}
