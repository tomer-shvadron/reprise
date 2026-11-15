import { IGNORED_HEADERS, lookupOpcode, parseValue } from './opcodes';
import { bump } from './report';
import type { SfzReport } from './report';

/** One `<region>` with the opcodes it inherits: control, global, master, group, then its own. */
export interface ParsedRegion {
  /** Canonical opcode name to its parsed value; `key` is already spread over its three. */
  ops: ReadonlyMap<string, number | string>;
}

type Level = 'control' | 'global' | 'master' | 'group' | 'region' | 'ignored';

const TOKEN = /<(\w+)>|(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=/g;

/** Opcodes whose value is a path or free text and may therefore hold spaces. */
const SPACED = new Set(['path', 'text']);

/**
 * Tokenizes preprocessed SFZ text into regions. Headers and opcodes may share a line; an
 * opcode's value runs to the next opcode or header (paths and labels keep their spaces, every
 * other value stops at whitespace). A new header resets the levels below it. Names are
 * lowercased, aliases fold into the canonical name so an override across spellings works, and
 * opcodes left out are counted in the report.
 */
export function parseSfz(text: string, report: SfzReport): ParsedRegion[] {
  const levels = {
    control: new Map<string, number | string>(),
    global: new Map<string, number | string>(),
    master: new Map<string, number | string>(),
    group: new Map<string, number | string>(),
    region: new Map<string, number | string>(),
  };
  const regions: ParsedRegion[] = [];
  let level: Level | undefined;
  let open = false;

  const flush = (): void => {
    if (!open) return;
    open = false;
    regions.push({
      ops: new Map([
        ...levels.control,
        ...levels.global,
        ...levels.master,
        ...levels.group,
        ...levels.region,
      ]),
    });
  };

  const header = (name: string): void => {
    flush();
    switch (name) {
      case 'control': {
        levels.control.clear();
        level = 'control';
        break;
      }
      case 'global': {
        levels.global.clear();
        levels.master.clear();
        levels.group.clear();
        level = 'global';
        break;
      }
      case 'master': {
        levels.master.clear();
        levels.group.clear();
        level = 'master';
        break;
      }
      case 'group': {
        levels.group.clear();
        level = 'group';
        break;
      }
      case 'region': {
        levels.region.clear();
        level = 'region';
        open = true;
        break;
      }
      default: {
        if (IGNORED_HEADERS.has(name)) bump(report.ignoredHeaders, name);
        else bump(report.ignoredHeaders, `unknown:${name}`);
        level = 'ignored';
      }
    }
  };

  const set = (spelling: string, raw: string): void => {
    if (level === undefined || level === 'ignored') return;
    const found = lookupOpcode(spelling);
    if (found.type === 'unknown') {
      bump(report.unknown, spelling);
      return;
    }
    if (found.type === 'unsupported') {
      bump(report.unsupported, spelling);
      return;
    }
    const { spec } = found;
    if (spec.name === 'pitch_keycenter' && raw.toLowerCase() === 'sample') {
      bump(report.unsupported, 'pitch_keycenter=sample');
      return;
    }
    const value = parseValue(spec, raw);
    if (value === undefined) {
      bump(report.invalid, spec.name);
      return;
    }
    bump(report.used, spelling);
    const target = levels[level];
    if (spec.name === 'key') {
      target.set('lokey', value);
      target.set('hikey', value);
      target.set('pitch_keycenter', value);
    } else {
      target.set(spec.name, value);
    }
  };

  for (const line of text.split('\n')) {
    const markers = [...line.matchAll(TOKEN)];
    for (const [index, marker] of markers.entries()) {
      const next = markers[index + 1];
      if (marker[1] !== undefined) {
        header(marker[1].toLowerCase());
        continue;
      }
      const spelling = (marker[2] ?? '').toLowerCase();
      const start = marker.index + marker[0].length;
      const slice = line.slice(start, next ? next.index : line.length).trim();
      const found = lookupOpcode(spelling);
      const spaced = found.type === 'supported' && SPACED.has(found.spec.kind);
      set(spelling, spaced ? slice : (slice.split(/\s+/)[0] ?? ''));
    }
  }
  flush();
  return regions;
}
