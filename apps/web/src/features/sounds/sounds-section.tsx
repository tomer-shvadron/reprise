import { useId } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useSetting } from '@/app/use-setting';
import { Button } from '@/components/ui/button';
import type { SettingsSection } from '@/features/settings';
import { SettingRow } from '@/features/settings/setting-rows';

import { curatedPack } from './curated-packs';
import { DEFAULT_SOUND_SETTINGS, type DefaultSound } from './default-sounds';
import { FAMILY_LABELS, PACK_FAMILIES, type InstalledPack, type PackFamily } from './manifest';
import { PHASE_LABELS } from './pack-sections';

const GM = 'gm';
const MISSING = 'missing';

interface Option {
  value: string;
  label: string;
  choice: DefaultSound;
}

/** One option per instrument of a multi-instrument pack, one per pack otherwise. */
function optionsOf(pack: InstalledPack): Option[] {
  if (pack.instruments.length === 1) {
    return [{ value: pack.id, label: pack.name, choice: { packId: pack.id } }];
  }
  return pack.instruments.map((instrument) => ({
    value: `${pack.id}/${instrument.key}`,
    label: `${pack.name}: ${instrument.name}`,
    choice: { packId: pack.id, instrument: instrument.key },
  }));
}

function FamilyRow({ family }: { family: PackFamily }) {
  const def = DEFAULT_SOUND_SETTINGS[family];
  const { settings, sounds, platform, ui } = useAppServices();
  const stored = useSetting(def);
  const packs = useStore(sounds.api, (state) => state.packs);
  const scanned = useStore(sounds.api, (state) => state.scanned);
  const job = useStore(sounds.api, (state) => state.job);
  const problems = useStore(sounds.api, (state) => state.problems);
  const descriptionId = useId();
  const id = useId();

  const suggested = packs.filter((pack) => pack.family === family).flatMap(optionsOf);
  const others = packs.filter((pack) => pack.family !== family).flatMap(optionsOf);
  const all = [...suggested, ...others];

  let value = GM;
  let missingLabel: string | undefined;
  let description: string | undefined;
  // An installed pack without the stored instrument is not fixed by downloading it again.
  let pack: InstalledPack | undefined;
  if (stored !== 'gm') {
    pack = packs.find((p) => p.id === stored.packId);
    // The first instrument plays for a stored choice that names none.
    const key = stored.instrument ?? pack?.instruments[0]?.key;
    const listed = curatedPack(stored.packId);
    const instrumentName =
      pack?.instruments.find((i) => i.key === key)?.name ??
      listed?.instruments.find((i) => i.key === key)?.name ??
      stored.instrument;
    const packName = pack?.name ?? listed?.name ?? stored.packId;
    if (pack?.instruments.some((i) => i.key === key)) {
      value = pack.instruments.length === 1 ? stored.packId : `${stored.packId}/${String(key)}`;
    } else {
      value = MISSING;
      const full = instrumentName === undefined ? packName : `${packName}: ${instrumentName}`;
      missingLabel = pack ? `${full} (not in the installed version)` : full;
      description = pack
        ? 'Not in the installed version of the pack: plays General MIDI.'
        : 'Not installed: plays General MIDI.';
    }
  }

  const curated = stored === 'gm' ? undefined : curatedPack(stored.packId);
  const installing = stored !== 'gm' && job?.packId === stored.packId ? job : undefined;
  const failure = stored === 'gm' ? undefined : problems[stored.packId];
  if (!scanned) description = undefined;
  if (description !== undefined && failure) {
    description = `${description} The download failed: ${failure.message}`;
  }
  // Before the first scan every pack reads as not installed.
  const showAction = missingLabel !== undefined && scanned;
  const downloadable =
    pack === undefined && platform.download !== undefined && curated?.directDownload === true
      ? curated
      : undefined;

  const options = (entries: readonly Option[]) =>
    entries.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ));

  return (
    <SettingRow
      label={FAMILY_LABELS[family]}
      htmlFor={id}
      {...(description !== undefined && { description, descriptionId })}
    >
      <div className="flex items-center gap-2">
        {showAction &&
          (installing ? (
            <span role="status" className="text-muted-foreground text-xs">
              {PHASE_LABELS[installing.phase]}
            </span>
          ) : downloadable ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                void sounds.installCurated(downloadable);
              }}
            >
              {failure ? 'Retry' : 'Download'}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                ui.getState().closeSettings();
                ui.getState().showSheet('sounds');
              }}
            >
              Open Sounds
            </Button>
          ))}
        <select
          id={id}
          aria-describedby={description === undefined ? undefined : descriptionId}
          value={value}
          className="border-input bg-background h-8 w-56 rounded-md border px-2 text-sm"
          onChange={(event) => {
            const picked = event.target.value;
            if (picked === GM) settings.set(def, 'gm');
            else {
              const option = all.find((o) => o.value === picked);
              if (option) settings.set(def, option.choice);
            }
          }}
        >
          <option value={GM}>General MIDI</option>
          {missingLabel !== undefined && <option value={MISSING}>{missingLabel}</option>}
          {suggested.length > 0 && <optgroup label="Suggested">{options(suggested)}</optgroup>}
          {others.length > 0 && <optgroup label="Other packs">{options(others)}</optgroup>}
        </select>
      </div>
    </SettingRow>
  );
}

function Sounds() {
  return (
    <>
      <p className="text-muted-foreground pb-1 text-xs">
        What each kind of track plays when the song names no sound pack. The default is applied
        while playing and is never saved into the song; pick a sound in the mixer to save one.
      </p>
      {PACK_FAMILIES.map((family) => (
        <FamilyRow key={family} family={family} />
      ))}
    </>
  );
}

export const soundsSection: SettingsSection = {
  id: 'sounds',
  title: 'Sounds',
  settings: Object.values(DEFAULT_SOUND_SETTINGS),
  Component: Sounds,
};
