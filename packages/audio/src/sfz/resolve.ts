import type { Envelope, Region } from '../sampler/region-map';
import { resolvePath } from './paths';
import type { ParsedRegion } from './parse';
import { bump } from './report';
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

function envelope(ops: ParsedRegion['ops']): Envelope {
  const seconds = (name: string, fallback: number): number =>
    Math.max(0, num(ops, name) ?? fallback);
  const delay = seconds('ampeg_delay', 0);
  return {
    ...(delay > 0 && { delay }),
    attack: seconds('ampeg_attack', 0),
    hold: seconds('ampeg_hold', 0),
    decay: seconds('ampeg_decay', 0),
    sustain: clamp((num(ops, 'ampeg_sustain') ?? 100) / 100, 0, 1),
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
): { regions: Region[]; swLast: number | undefined; swDefault: number | undefined } | null {
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

  const shift = (num(ops, 'note_offset') ?? 0) + 12 * (num(ops, 'octave_offset') ?? 0);
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
    envelope: envelope(ops),
  };
  if (options.layer !== undefined) common.layer = options.layer;

  const volume = num(ops, 'volume') ?? 0;
  if (volume !== 0) common.attenuation = -volume;
  const pan = num(ops, 'pan');
  if (pan) common.pan = clamp(pan / 100, -1, 1);
  const veltrack = num(ops, 'amp_veltrack');
  if (veltrack !== undefined && veltrack !== 100) {
    if (veltrack < 0 || veltrack > 100) bump(report.clamped, 'amp_veltrack');
    common.velocityTrack = clamp(veltrack / 100, 0, 1);
  }

  const mode = text(ops, 'loop_mode') ?? 'no_loop';
  if (mode === 'one_shot') {
    common.oneShot = true;
  } else if (mode !== 'no_loop') {
    const start = num(ops, 'loop_start');
    const end = num(ops, 'loop_end');
    if (start === undefined || end === undefined) {
      report.embeddedLoop += 1;
    } else if (start < 0 || end <= start) {
      bump(report.invalid, 'loop_end');
    } else {
      // SFZ's loop_end is the last frame of the loop, the buffer's loopEnd is exclusive.
      common.loop = { start, end: end + 1, unit: 'frames' };
    }
  }
  const startFrame = num(ops, 'offset');
  if (startFrame !== undefined && startFrame > 0) common.startFrame = startFrame;

  const group = num(ops, 'group');
  if (group !== undefined && group > 0) common.group = group;
  const offBy = num(ops, 'off_by');
  if (offBy !== undefined && offBy > 0) common.offBy = offBy;

  const trigger = text(ops, 'trigger');
  if (trigger === 'release' || trigger === 'first' || trigger === 'legato') {
    common.trigger = trigger;
  }
  const length = num(ops, 'seq_length');
  const position = num(ops, 'seq_position') ?? 1;
  if (length !== undefined && length > 1) {
    if (position < 1 || position > length) bump(report.invalid, 'seq_position');
    else common.sequence = { length, position };
  }
  if (lo > 0 || hi < 1) common.random = { lo, hi };

  const cents = (num(ops, 'tune') ?? 0) + 100 * (num(ops, 'transpose') ?? 0);
  const keytrack = num(ops, 'pitch_keytrack') ?? 100;
  const regions: Region[] = [];
  if (keytrack === 100) {
    regions.push({ ...common, tune: cents });
  } else {
    // One region per key, rooted on itself: the voice's own key tracking cannot be turned down,
    // so the pitch offset from the centre is baked into the tuning, as SF2's scaleTuning does.
    for (let key = keyLo; key <= keyHi; key += 1) {
      regions.push({
        ...common,
        keyLo: key,
        keyHi: key,
        rootKey: key,
        tune: cents + keytrack * (key - center),
      });
    }
  }
  return { regions, swLast: note('sw_last'), swDefault: note('sw_default') };
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
    for (const region of result.regions) built.push({ region, swLast: result.swLast });
    swDefault ??= result.swDefault;
    const label = text(source.ops, 'sw_label');
    if (result.swLast !== undefined && label !== undefined && !labels.has(result.swLast)) {
      labels.set(result.swLast, label);
    }
    const swLo = num(source.ops, 'sw_lokey');
    const swHi = num(source.ops, 'sw_hikey');
    if (swLo !== undefined && swHi !== undefined) {
      swRange = {
        lo: Math.min(swRange?.lo ?? swLo, swLo),
        hi: Math.max(swRange?.hi ?? swHi, swHi),
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
      for (const { region, swLast } of built) {
        if (swLast === undefined || swLast === key) {
          regions.push({ ...region, layer: layerOf(key) });
        }
      }
    }
  }
  return { regions, layers, ...(swRange && { keyswitchRange: swRange }) };
}
