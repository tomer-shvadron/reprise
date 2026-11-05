import type { Score } from '@reprise/model';

import { buildScore } from './build-score';
import { GpifError } from './errors';
import { readPartConfiguration, type TrackNotation } from './part-configuration';
import { readDocument } from './read-document';
import { WarningCollector, type GpifWarning } from './warnings';
import { XmlError, parseXml, type XmlElement } from './xml';

declare const TextDecoder: new (
  label: string,
  options: { fatal: boolean },
) => { decode(input: Uint8Array): string };

export interface GpifReadOptions {
  /**
   * The container's `PartConfiguration` bytes, the only record of which tracks show tablature;
   * without them a track's notation falls back to its kind's default.
   */
  partConfiguration?: Uint8Array;
}

export interface GpifReadResult {
  score: Score;
  warnings: GpifWarning[];
}

/**
 * Reads a `score.gpif` document, the XML model shared by Guitar Pro 6 (`.gpx`) and 7 and 8
 * (`.gp`); the containers only differ in how they store it. Throws `GpifError` when there is no
 * score to read (bad UTF-8, malformed XML with its position, a root that is not `GPIF`, no tracks
 * or bars); everything recoverable is a warning.
 */
export function readGpif(
  input: string | Uint8Array,
  options: GpifReadOptions = {},
): GpifReadResult {
  let source: string;
  if (typeof input === 'string') source = input;
  else {
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw new GpifError('invalid-utf8', 'score.gpif is not valid UTF-8');
    }
  }

  let root: XmlElement;
  try {
    root = parseXml(source);
  } catch (error) {
    if (error instanceof XmlError) {
      throw new GpifError('invalid-xml', `score.gpif is not well-formed XML: ${error.message}`, {
        line: error.line,
        column: error.column,
      });
    }
    throw error;
  }

  const collector = new WarningCollector();
  const document = readDocument(collector, root);
  let notation: TrackNotation[] | undefined;
  if (options.partConfiguration) {
    notation = readPartConfiguration(options.partConfiguration);
    if (notation?.length !== document.trackOrder.length) {
      collector.warn(
        'invalid-value',
        'PartConfiguration',
        'The part configuration does not list one entry per track; notation falls back to defaults',
      );
      notation = undefined;
    }
  }
  const score = buildScore(collector, document, notation);
  return { score, warnings: collector.warnings };
}
