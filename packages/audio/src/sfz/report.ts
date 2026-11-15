/**
 * What a load found beyond the regions: every opcode left out is counted by name, so a pack that
 * sounds wrong can be diagnosed without reading its SFZ files, and a real-pack check can fail on
 * the entries that mean data was lost.
 */
export interface SfzReport {
  /** Supported opcodes by the spelling the file used, aliases included. */
  used: Record<string, number>;
  /** Opcodes this loader does not know. */
  unknown: Record<string, number>;
  /** Opcodes it knows but v1 does not play (filters, LFOs, controllers, ...). */
  unsupported: Record<string, number>;
  /** Headers it skips (`<curve>`, `<effect>`, `<midi>`, `<sample>`), with their opcodes. */
  ignoredHeaders: Record<string, number>;
  /** Values that did not parse; the opcode is skipped and the region kept. */
  invalid: Record<string, number>;
  /** Values clamped into their range. */
  clamped: Record<string, number>;
  /** Regions left out, by reason. */
  dropped: Record<string, number>;
  /** Looped regions whose loop points live inside the audio file, which v1 does not read. */
  embeddedLoop: number;
  /** `#include` targets that could not be read or that cycle or nest too deep. */
  unresolvedIncludes: string[];
  /** Paths that escape the pack root, refused because pack files are untrusted. */
  escapedPaths: string[];
  /** Work caps that were hit; the load stopped expanding there and returned what it had. */
  limits: string[];
  /** Regions with loop points and no `loop_mode`: played unlooped, though some players would loop them. */
  loopWithoutMode: number;
  /**
   * Regions kept that can never play: `seq_position` outside `seq_length`, an authoring error some
   * packs ship. They are silent, as in sfizz, and nothing the loader lost, so `isClean` allows them.
   */
  unreachable: number;
  /** Choices the loader made that a pack author might not expect. */
  notes: string[];
  regions: number;
}

/**
 * Caps on what an untrusted pack can make a load do, generous for real packs (the largest ship a
 * few thousand regions in a handful of files) and far below what a hostile one could ask for.
 */
export const LIMITS = {
  /** Files read in one load, the root and every include counted, so a diamond of includes stops. */
  includeReads: 256,
  /** Characters of preprocessed text; also bounds any one substituted line. */
  textLength: 4_000_000,
  /** Characters of one `#define` value, so a doubling chain of defines stops early. */
  defineLength: 65_536,
  /** Regions after `pitch_keytrack` expansion and keyswitch layer copies. */
  regions: 100_000,
};

export function emptyReport(): SfzReport {
  return {
    used: {},
    unknown: {},
    unsupported: {},
    ignoredHeaders: {},
    invalid: {},
    clamped: {},
    dropped: {},
    embeddedLoop: 0,
    unresolvedIncludes: [],
    escapedPaths: [],
    limits: [],
    loopWithoutMode: 0,
    unreachable: 0,
    notes: [],
    regions: 0,
  };
}

export function bump(counts: Record<string, number>, name: string): void {
  counts[name] = (counts[name] ?? 0) + 1;
}

/** True when nothing was lost that a real pack should not lose; `unknown` and `unsupported` are allowed. */
export function isClean(report: SfzReport): boolean {
  return (
    Object.keys(report.invalid).length === 0 &&
    report.unresolvedIncludes.length === 0 &&
    report.escapedPaths.length === 0 &&
    report.limits.length === 0
  );
}
