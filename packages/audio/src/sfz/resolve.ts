import type { Envelope, Region } from '../sampler/region-map';
import { resolvePath } from './paths';
import type { ParsedRegion } from './parse';
import { LIMITS, bump } from './report';
import type { SfzReport } from './report';

export interface SfzResolveOptions {
  /** Prefix of every sample ref: `sfz:<packId>/<path>`. */
  packId: string;
  /** The directory sample paths are relative to, the root SFZ file's own; '' for the pack root. */
  baseDir?: string;
  /** Puts the whole file under one layer name, for packs that ship an SFZ file per articulation. */
  layer?: string;
}

/** A keyswitch articulation: select it by `id`, which the loader and WP-093 share. */
export interface SfzLayer {
  id: string;
  /** The `sw_last` note that selects it in the pack. */
  key: number;
  label?: string;
}

export interface SfzResolved {
  regions: Region[];
  layers: SfzLayer[];
  /** The keys the pack uses to switch articulations; the score never presses them. */
  keyswitchRange?: { lo: number; hi: number };
}

const SYNTHETIC_SAMPLE = /^\*(sine|silence|noise|saw|square|tri)/i;
const DEFAULT_ROOT = 60;
const DEFAULT_RELEASE = 0.001;

const num = (ops: ParsedRegion['ops'], name: string): number | undefined => {
  const value = ops.get(name);
  return typeof value === 'number' ? value : undefined;
};

const text = (ops: ParsedRegion['ops'], name: string): string | undefined => {
  const value = ops.get(name);
  return typeof value === 'string' ? value : undefined;
};

const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

/** A numeric opcode clamped into its SFZ range and counted when it was outside it. */
function ranged(
  ops: ParsedRegion['ops'],
  report: SfzReport,
  name: string,
  lo: number,
  hi: number,
): number | undefined {
  const value = num(ops, name);
  if (value === undefined) return undefined;
  const inside = clamp(value, lo, hi);
  if (inside !== value) bump(report.clamped, name);
  return inside;
}

const MAX_FRAME = 2 ** 31 - 1;

function envelope(ops: ParsedRegion['ops'], report: SfzReport): Envelope {
  const seconds = (name: string, fallback: number): number =>
    ranged(ops, report, name, 0, 100) ?? fallback;
  const delay = seconds('ampeg_delay', 0);
  return {
    ...(delay > 0 && { delay }),
    attack: seconds('ampeg_attack', 0),
    hold: seconds('ampeg_hold', 0),
    decay: seconds('ampeg_decay', 0),
    sustain: (ranged(ops, report, 'ampeg_sustain', 0, 100) ?? 100) / 100,
    release: seconds('ampeg_release', DEFAULT_RELEASE),
  };
}

interface Built {
  region: Region;
  swLast: number | undefined;
}

/** One SFZ region as zero or more shared `Region`s (more when `pitch_keytrack` expands it). */
function build(
  parsed: ParsedRegion,
  options: SfzResolveOptions,
  report: SfzReport,
): {
  regions: Region[];
  swLast: number | undefined;
  swDefault: number | undefined;
  swRange: { lo: number; hi: number } | undefined;
} | null {
  const { ops } = parsed;
  const drop = (reason: string): null => {
    bump(report.dropped, reason);
    return null;
  };

  const raw = text(ops, 'sample');
  if (raw === undefined) return drop('noSample');
  if (SYNTHETIC_SAMPLE.test(raw)) return drop('generator');
  const path = resolvePath(options.baseDir ?? '', text(ops, 'default_path') ?? '', raw);
  if (path === undefined) {
    report.escapedPaths.push(raw);
    return drop('escapesRoot');
  }

  const shift =
    (ranged(ops, report, 'note_offset', -127, 127) ?? 0) +
    12 * (ranged(ops, report, 'octave_offset', -10, 10) ?? 0);
  const note = (name: string): number | undefined => {
    const value = num(ops, name);
    return value === undefined ? undefined : value + shift;
  };
  const rawLo = num(ops, 'lokey');
  const rawHi = num(ops, 'hikey');
  if (rawLo === -1 || rawHi === -1) return drop('disabledKey');
  const keyLo = clamp(note('lokey') ?? 0, 0, 127);
  const keyHi = clamp(note('hikey') ?? 127, 0, 127);
  if (keyLo > keyHi) return drop('badKeyRange');
  const center = clamp(note('pitch_keycenter') ?? DEFAULT_ROOT, 0, 127);

  const velLo = num(ops, 'lovel') ?? 0;
  const velHi = num(ops, 'hivel') ?? 127;
  if (velLo < 0 || velHi > 127 || velLo > velHi) return drop('badVelocity');

  const lo = num(ops, 'lorand') ?? 0;
  const hi = num(ops, 'hirand') ?? 1;
  if (lo < 0 || hi > 1 || lo >= hi) return drop('badRandom');

  const common: Region = {
    keyLo,
    keyHi,
    velLo,
    velHi,
    rootKey: center,
    tune: 0,
    sample: `sfz:${options.packId}/${path}`,
    envelope: envelope(ops, report),
  };
  if (options.layer !== undefined) common.layer = options.layer;

  const volume = ranged(ops, report, 'volume', -144, 6) ?? 0;
  if (volume !== 0) common.attenuation = -volume;
  const pan = ranged(ops, report, 'pan', -100, 100);
  if (pan) common.pan = clamp(pan / 100, -1, 1);
  const veltrack = ranged(ops, report, 'amp_veltrack', 0, 100);
  if (veltrack !== undefined && veltrack !== 100) common.velocityTrack = veltrack / 100;

  const declared = text(ops, 'loop_mode');
  const mode = declared ?? 'no_loop';
  if (declared === undefined && (ops.has('loop_start') || ops.has('loop_end'))) {
    report.loopWithoutMode += 1;
  }
  if (mode === 'one_shot') {
    common.oneShot = true;
  } else if (mode !== 'no_loop') {
    const start = ranged(ops, report, 'loop_start', 0, MAX_FRAME);
    const end = ranged(ops, report, 'loop_end', 0, MAX_FRAME);
    if (start === undefined || end === undefined) {
      report.embeddedLoop += 1;
    } else if (end <= start) {
      bump(report.invalid, 'loop_end');
    } else {
      // SFZ's loop_end is the last frame of the loop, the buffer's loopEnd is exclusive.
      common.loop = { start, end: end + 1, unit: 'frames' };
    }
  }
  const startFrame = ranged(ops, report, 'offset', 0, MAX_FRAME);
  if (startFrame !== undefined && startFrame > 0) common.startFrame = startFrame;

  const group = ranged(ops, report, 'group', 0, MAX_FRAME);
  if (group !== undefined && group > 0) common.group = group;
  const offBy = ranged(ops, report, 'off_by', 0, MAX_FRAME);
  if (offBy !== undefined && offBy > 0) common.offBy = offBy;

  const trigger = text(ops, 'trigger');
  if (trigger === 'release' || trigger === 'first' || trigger === 'legato') {
    common.trigger = trigger;
  }
  const length = ranged(ops, report, 'seq_length', 0, 1024);
  const position = ranged(ops, report, 'seq_position', 0, 1024) ?? 1;
  if (length !== undefined && length > 1) {
    // Kept even when `position` is outside 1..length, as sfizz does: `(n % length) + 1 ===
    // position` is then never true, so the region is silent. Dropping the sequence instead would
    // make it play on every note, layered on the position-1 take.
    common.sequence = { length, position };
    if (position < 1 || position > length) report.unreachable += 1;
  }
  if (lo > 0 || hi < 1) common.random = { lo, hi };

  const cents =
    (ranged(ops, report, 'tune', -1200, 1200) ?? 0) +
    100 * (ranged(ops, report, 'transpose', -127, 127) ?? 0);
  const keytrack = ranged(ops, report, 'pitch_keytrack', -1200, 1200) ?? 100;
  // Whatever the pieces add up to, the voice's playback rate stays a finite number.
  const tuned = (value: number): number => clamp(value, -9600, 9600);
  const regions: Region[] = [];
  if (keytrack === 100) {
    regions.push({ ...common, tune: tuned(cents) });
  } else {
    // One region per key, rooted on itself: the voice's own key tracking cannot be turned down,
    // so the pitch offset from the centre is baked into the tuning, as SF2's scaleTuning does.
    for (let key = keyLo; key <= keyHi; key += 1) {
      regions.push({
        ...common,
        keyLo: key,
        keyHi: key,
        rootKey: key,
        tune: tuned(cents + keytrack * (key - center)),
      });
    }
  }
  const swLo = note('sw_lokey');
  const swHi = note('sw_hikey');
  return {
    regions,
    swLast: note('sw_last'),
    swDefault: note('sw_default'),
    swRange: swLo !== undefined && swHi !== undefined ? { lo: swLo, hi: swHi } : undefined,
  };
}

function limitHit(report: SfzReport, reason: string): void {
  if (!report.limits.includes(reason)) report.limits.push(reason);
}

/**
 * Maps parsed SFZ regions onto the shared `Region`, in file order. Keyswitches become layers:
 * `sw:<k>` per distinct `sw_last`, with each unswitched region copied into every layer (SFZ
 * plays it under any keyswitch; the copies share one sample ref, so no sample memory). The default
 * layer holds the unswitched regions plus the `sw_default` layer's, or the lowest switch's when
 * the pack names none, so it is never silent.
 */
export function resolveSfz(
  parsed: readonly ParsedRegion[],
  options: SfzResolveOptions,
  report: SfzReport,
): SfzResolved {
  const built: Built[] = [];
  let swDefault: number | undefined;
  const labels = new Map<number, string>();
  let swRange: { lo: number; hi: number } | undefined;
  for (const source of parsed) {
    const result = build(source, options, report);
    if (!result) continue;
    if (built.length + result.regions.length > LIMITS.regions) {
      limitHit(report, `regions (more than ${String(LIMITS.regions)} after expansion)`);
      break;
    }
    for (const region of result.regions) built.push({ region, swLast: result.swLast });
    swDefault ??= result.swDefault;
    const label = text(source.ops, 'sw_label');
    if (result.swLast !== undefined && label !== undefined && !labels.has(result.swLast)) {
      labels.set(result.swLast, label);
    }
    if (result.swRange) {
      swRange = {
        lo: Math.min(swRange?.lo ?? result.swRange.lo, result.swRange.lo),
        hi: Math.max(swRange?.hi ?? result.swRange.hi, result.swRange.hi),
      };
    }
  }
  report.regions = built.length;

  const keys = [...new Set(built.flatMap(({ swLast }) => (swLast === undefined ? [] : [swLast])))];
  keys.sort((a, b) => a - b);
  const prefix = options.layer === undefined ? '' : `${options.layer}/`;
  const layerOf = (key: number): string => `${prefix}sw:${String(key)}`;
  const layers: SfzLayer[] = keys.map((key) => ({
    id: layerOf(key),
    key,
    ...(labels.has(key) && { label: labels.get(key) ?? '' }),
  }));

  const regions: Region[] = [];
  if (keys.length === 0) {
    for (const { region } of built) regions.push(region);
  } else {
    const first = keys[0];
    const selected = swDefault !== undefined && keys.includes(swDefault) ? swDefault : first;
    if (selected !== swDefault) {
      report.notes.push(`No usable sw_default: the default layer plays ${layerOf(selected ?? 0)}`);
    }
    for (const { region, swLast } of built) {
      if (swLast === undefined || swLast === selected) regions.push(region);
    }
    for (const key of keys) {
      const copies = built.filter(({ swLast }) => swLast === undefined || swLast === key).length;
      if (regions.length + copies > LIMITS.regions) {
        limitHit(report, `regions (keyswitch layer copies past ${String(LIMITS.regions)})`);
        break;
      }
      for (const { region, swLast } of built) {
        if (swLast === undefined || swLast === key) {
          regions.push({ ...region, layer: layerOf(key) });
        }
      }
    }
  }
  return { regions, layers, ...(swRange && { keyswitchRange: swRange }) };
}
