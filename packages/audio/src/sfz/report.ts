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
  /** Choices the loader made that a pack author might not expect. */
  notes: string[];
  regions: number;
}

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
    report.escapedPaths.length === 0
  );
}
