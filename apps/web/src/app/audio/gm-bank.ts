import {
  PERCUSSION_BANK,
  type Instrument,
  type InstrumentId,
  type ManagedSampleSource,
  type RegionMap,
  type Sf2Soundfont,
} from '@reprise/audio';
import type { Track } from '@reprise/model';

type TrackKey = Pick<Track, 'kind' | 'bank'>;

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
    const bank = track.kind === 'drums' ? PERCUSSION_BANK : track.bank;
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
