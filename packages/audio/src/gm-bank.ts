import { stringInstrumentOf } from '@reprise/model';
import type { Track } from '@reprise/model';

import type { RegionMap } from './sampler/region-map';
import type { Instrument } from './sampler/sampler';
import type { ManagedSampleSource } from './samples/managed-sample-source';
import type { InstrumentId } from './samples/types';
import { PERCUSSION_BANK } from './sf2/soundfont';
import type { Sf2Soundfont } from './sf2/soundfont';

type TrackKey = Pick<Track, 'kind' | 'bank'> & Partial<Pick<Track, 'tuning' | 'courses' | 'drone'>>;

/** General MIDI's steel guitar program, which a mandolin track carries (GM has no mandolin). */
const MANDOLIN_PROGRAM = 25;
/** GeneralUser GS's Mandolin variation of that program. */
const MANDOLIN_BANK = 16;

/**
 * The bank a track plays: a mandolin on program 25 in the default bank takes GeneralUser's
 * Mandolin variation, chosen here at play time rather than stored in `Track.bank` (#411). A font
 * without it falls back to the program's own preset, as any missing bank does.
 */
function bankOf(track: TrackKey, program: number): number {
  if (
    track.kind === 'fretted' &&
    program === MANDOLIN_PROGRAM &&
    track.bank === 0 &&
    track.tuning &&
    stringInstrumentOf({ ...track, tuning: track.tuning, program }) === 'mandolin'
  ) {
    return MANDOLIN_BANK;
  }
  return track.bank;
}

interface Entry {
  id: InstrumentId;
  instrument: Instrument;
}

/**
 * The one answer to "which instrument" for the memory planner, the region maps, the sampler and
 * the sink. Ids come from the preset the soundfont actually resolves, never from the requested
 * bank and program: if the planner pinned `gm:8:25` while the buffers belong to `gm:0:25`, the
 * next song switch would evict the song's own samples.
 */
export class GmBank {
  readonly #font: Sf2Soundfont;
  readonly #entries = new Map<string, Entry>();
  readonly #maps = new Map<InstrumentId, RegionMap>();
  readonly source: ManagedSampleSource;

  constructor(font: Sf2Soundfont, source: ManagedSampleSource) {
    this.#font = font;
    this.source = source;
  }

  readonly instrumentId = (track: TrackKey, program: number): InstrumentId =>
    this.#entry(track, program).id;

  readonly regionMap = (id: InstrumentId): RegionMap | undefined => this.#maps.get(id);

  readonly instrument = (track: TrackKey, program: number): Instrument =>
    this.#entry(track, program).instrument;

  #entry(track: TrackKey, program: number): Entry {
    const bank = track.kind === 'drums' ? PERCUSSION_BANK : bankOf(track, program);
    const key = `${String(bank)}:${String(program)}`;
    const cached = this.#entries.get(key);
    if (cached) return cached;
    // A program the bank lacks still sounds, as the first preset.
    const [resolvedBank, resolvedProgram] = this.#font.resolve(bank, program)
      ? [bank, program]
      : [0, 0];
    const preset = this.#font.resolve(resolvedBank, resolvedProgram);
    const regions = this.#font.regionMapFor(resolvedBank, resolvedProgram);
    if (!preset || !regions) throw new Error('The sound bank has no presets');
    this.#maps.set(preset.id, regions);
    const entry = { id: preset.id, instrument: { regions, source: this.source } };
    this.#entries.set(key, entry);
    return entry;
  }
}
