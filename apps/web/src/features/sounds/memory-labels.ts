import { ARTICULATION_SETS, parsePackInstrumentId } from '@reprise/audio';

import { GM_DRUM_KITS, GM_PROGRAMS } from '@/lib/gm-programs';

import type { InstalledPack } from './manifest';

const GENERAL_MIDI = 'General MIDI';

/**
 * What a resident instrument id reads as on the memory panel. General MIDI ids are
 * `gm:<bank>:<program>` and `gm:drums:<kit>`; a pack's are `sfz:<packId>@<install>:<sfzPath>`, a
 * path, so it is mapped back to the instrument whose `entries` holds it. An id this does not know
 * comes back unchanged.
 */
export function instrumentLabel(id: string, packs: readonly InstalledPack[]): string {
  if (id.startsWith('sfz:')) return packLabel(id, packs);
  const parts = id.split(':');
  if (parts[0] !== 'gm' || parts.length !== 3) return id;
  const [, bank, number] = parts;
  const value = Number(number);
  if (!Number.isInteger(value)) return id;
  if (bank === 'drums')
    return `${GENERAL_MIDI}: ${GM_DRUM_KITS.get(value) ?? `Kit ${String(value)}`}`;
  const bankNumber = Number(bank);
  if (!Number.isInteger(bankNumber)) return id;
  const name = GM_PROGRAMS[value] ?? `Program ${String(value)}`;
  return `${GENERAL_MIDI}: ${name}${bankNumber === 0 ? '' : ` (bank ${String(bankNumber)})`}`;
}

const SET_LABELS: Record<(typeof ARTICULATION_SETS)[number], string> = {
  default: 'Default',
  palmMute: 'Palm mute',
  dead: 'Dead note',
  harmonic: 'Harmonic',
  artificialHarmonic: 'Artificial harmonic',
  legato: 'Legato',
  staccato: 'Staccato',
  tap: 'Tap',
  slap: 'Slap',
  pop: 'Pop',
};

const setLabel = (key: string): string =>
  (ARTICULATION_SETS as readonly string[]).includes(key)
    ? SET_LABELS[key as (typeof ARTICULATION_SETS)[number]]
    : key;

function packLabel(id: string, packs: readonly InstalledPack[]): string {
  const parsed = parsePackInstrumentId(id);
  if (!parsed) return id;
  const pack = packs.find((candidate) => candidate.id === parsed.packId);
  if (!pack) return `${parsed.packId} (removed)`;
  for (const instrument of pack.instruments) {
    for (const [key, path] of Object.entries(instrument.entries)) {
      if (path !== parsed.path) continue;
      const base = pack.instruments.length === 1 ? pack.name : `${pack.name}: ${instrument.name}`;
      return key === 'default' ? base : `${base} (${setLabel(key)})`;
    }
  }
  return `${pack.name}: ${parsed.path}`;
}
