import { MEGABYTE } from '@reprise/audio';
import { useId, useMemo, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { megabytes } from '@/features/transport/sound-status';

import { instrumentLabel } from './memory-labels';

/** "Memory for sounds" presets in MB, counted in MiB as the status bar counts. */
export const MEMORY_BUDGET_PRESETS_MB = [64, 128, 200, 300, 500, 750, 1000, 1500, 2000] as const;

const COLLAPSED = 8;

/**
 * The memory readout and setting: decoded and budget bytes, the instruments held in memory,
 * the budget select, "Unload unused" and the note shown while the song needs more than the budget.
 */
export function MemoryPanel({ onAnnounce }: { onAnnounce: (message: string) => void }) {
  const { playback, audio, sounds } = useAppServices();
  const memory = useStore(playback, (state) => state.memory);
  const budgetSetting = useStore(playback, (state) => state.settings.memoryBudgetBytes);
  const packs = useStore(sounds.api, (state) => state.packs);
  const [expanded, setExpanded] = useState(false);
  const selectId = useId();
  const listId = useId();

  const labels = useMemo(
    () =>
      memory.residents
        .map((id) => ({ id, label: instrumentLabel(id, packs) }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id)),
    [memory.residents, packs],
  );
  const shown = expanded ? labels : labels.slice(0, COLLAPSED);

  const budgetMb = Math.round(budgetSetting / MEGABYTE);
  const presets: number[] = MEMORY_BUDGET_PRESETS_MB.includes(
    budgetMb as (typeof MEMORY_BUDGET_PRESETS_MB)[number],
  )
    ? [...MEMORY_BUDGET_PRESETS_MB]
    : [...MEMORY_BUDGET_PRESETS_MB, budgetMb].sort((a, b) => a - b);

  const used = Math.min(memory.decodedBytes, memory.budgetBytes);
  const reading = `${megabytes(memory.decodedBytes)} MB of ${megabytes(memory.budgetBytes)} MB`;
  const nothingUnused = memory.unused.length === 0;
  const count = memory.residents.length;

  return (
    <section
      aria-label="Memory"
      data-slot="memory-readout"
      className="flex max-w-lg flex-col gap-2"
    >
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Memory</h2>
      <div className="flex flex-col gap-1">
        <div
          role="meter"
          aria-label="Sound memory in use"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(memory.budgetBytes / MEGABYTE))}
          aria-valuenow={Math.round(used / MEGABYTE)}
          aria-valuetext={reading}
          className="bg-muted h-2 w-full overflow-hidden rounded-full"
        >
          <div
            className="bg-primary h-full"
            style={{
              width: `${String(memory.budgetBytes > 0 ? (used / memory.budgetBytes) * 100 : 0)}%`,
            }}
          />
        </div>
        <p className="text-sm" data-memory-reading>
          {reading}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-sm">
          Memory for sounds
        </label>
        <select
          id={selectId}
          value={String(budgetMb)}
          className="border-input bg-background h-8 rounded-md border px-2 text-sm"
          onChange={(event) => {
            audio.setMemoryBudget(Number(event.target.value) * MEGABYTE);
          }}
        >
          {presets.map((mb) => (
            <option key={mb} value={String(mb)}>
              {mb} MB
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="sm"
          disabled={nothingUnused}
          onClick={() => {
            const freed = audio.unloadUnused();
            onAnnounce(`Freed ${String(freed)} ${freed === 1 ? 'instrument' : 'instruments'}`);
          }}
        >
          {nothingUnused ? 'Nothing unused' : 'Unload unused'}
        </Button>
      </div>
      {memory.shortfall && (
        <p className="text-sm" data-memory-shortfall>
          This song needs more than the budget; some notes may start late. Choose a larger amount of
          memory.
        </p>
      )}
      {count === 0 ? (
        <p className="text-muted-foreground text-sm">No sounds loaded</p>
      ) : (
        <>
          <p className="text-sm">
            {count} {count === 1 ? 'instrument' : 'instruments'} loaded
            {nothingUnused ? '' : `, ${String(memory.unused.length)} unused`}
          </p>
          <ul id={listId} aria-label="Loaded instruments" className="text-muted-foreground text-sm">
            {shown.map((entry) => (
              <li key={entry.id}>{entry.label}</li>
            ))}
          </ul>
          {labels.length > COLLAPSED && (
            <Button
              variant="link"
              size="xs"
              className="self-start"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              {expanded ? 'Show fewer' : `Show all ${String(labels.length)}`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
