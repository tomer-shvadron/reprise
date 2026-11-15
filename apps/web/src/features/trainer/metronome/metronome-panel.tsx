import { useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { parseBpm } from '@/features/transport';

import { addTap, CLICK_BPM, clampClickBpm, tapBpm } from './tap-tempo';

type Subdivision = 1 | 2 | 3 | 4;

const SUBDIVISIONS: { value: Subdivision; label: string }[] = [
  { value: 1, label: 'Quarter' },
  { value: 2, label: 'Eighth' },
  { value: 3, label: 'Triplet' },
  { value: 4, label: 'Sixteenth' },
];

/** The note value that carries the beat: the engine counts the beat the caller chose, so this is a label. */
const DENOMINATORS = [2, 4, 8] as const;
const NOTE_NAMES: Record<number, string> = { 2: 'half', 4: 'quarter', 8: 'eighth' };
const MAX_BEATS = 32;

/** A standalone click: no song needed, because the audio service owns a score-less click path. */
export function MetronomePanel() {
  const { audio, playback } = useAppServices();
  const { running, settings } = useStore(playback, (state) => state.click);
  const toggle = useCommand('trainer.metronomeToggle');
  const [denominator, setDenominator] = useState<number>(4);
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const [taps, setTaps] = useState<number[]>([]);

  const setBpm = (bpm: number) => {
    audio.updateClick({ bpm: clampClickBpm(bpm) });
  };
  const commitBpm = () => {
    const parsed = draft === undefined ? undefined : parseBpm(draft);
    if (parsed !== undefined && parsed >= CLICK_BPM.min && parsed <= CLICK_BPM.max) {
      setBpm(parsed);
    }
    setDraft(undefined);
  };
  const onBpmKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitBpm();
    } else if (event.key === 'Escape') {
      setDraft(undefined);
    }
  };
  const tap = (time: number) => {
    const next = addTap(taps, time);
    setTaps(next);
    const bpm = tapBpm(next);
    if (bpm !== undefined) setBpm(bpm);
  };
  const accented = settings.accents.length > 0 && settings.accents[0] === true;
  const toggleLabel = toggle.keys ? `${toggle.title} (${toggle.keys})` : toggle.title;

  return (
    <section aria-label="Metronome" className="flex flex-col gap-3 p-3 text-sm">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Metronome
      </h2>

      <Button
        size="sm"
        variant={running ? 'default' : 'outline'}
        aria-keyshortcuts={toggle.keys}
        title={toggleLabel}
        onClick={toggle.run}
      >
        {running ? 'Stop' : 'Start'}
      </Button>

      <div className="flex flex-col gap-1">
        <label htmlFor="metronome-bpm" className="text-muted-foreground text-xs">
          Tempo, BPM of the {NOTE_NAMES[denominator] ?? 'quarter'} note
        </label>
        <div className="flex items-center gap-2">
          <input
            id="metronome-bpm"
            inputMode="decimal"
            className="border-input bg-background h-7 w-20 rounded-md border px-2 text-right tabular-nums"
            value={draft ?? String(settings.bpm)}
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onBlur={commitBpm}
            onKeyDown={onBpmKey}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={(event) => {
              tap(event.timeStamp);
            }}
          >
            Tap tempo
          </Button>
        </div>
        <Slider
          value={[settings.bpm]}
          min={CLICK_BPM.min}
          max={CLICK_BPM.max}
          step={1}
          thumbLabel="Tempo"
          valueText={(value) => `${String(value)} BPM`}
          onValueChange={([next]) => {
            if (next !== undefined) setBpm(next);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Time signature</span>
        <div className="flex items-center gap-2">
          <input
            aria-label="Beats per bar"
            type="number"
            min={1}
            max={MAX_BEATS}
            className="border-input bg-background h-7 w-14 rounded-md border px-2 text-right tabular-nums"
            value={settings.beatsPerBar}
            onChange={(event) => {
              const beats = Number(event.currentTarget.value);
              if (Number.isInteger(beats) && beats >= 1 && beats <= MAX_BEATS) {
                audio.updateClick({ beatsPerBar: beats });
              }
            }}
          />
          <span aria-hidden="true">/</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Beat note"
            value={String(denominator)}
            onValueChange={(value) => {
              const next = Number(value);
              if (value && DENOMINATORS.some((d) => d === next)) setDenominator(next);
            }}
          >
            {DENOMINATORS.map((d) => (
              <ToggleGroupItem key={d} value={String(d)}>
                {String(d)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Subdivision</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Subdivision"
          value={String(settings.subdivision)}
          onValueChange={(value) => {
            const next = SUBDIVISIONS.find((s) => String(s.value) === value);
            if (next) audio.updateClick({ subdivision: next.value });
          }}
        >
          {SUBDIVISIONS.map((s) => (
            <ToggleGroupItem key={s.value} value={String(s.value)}>
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <label className="flex items-center justify-between gap-2">
        <span>Accent the downbeat</span>
        <Switch
          checked={accented}
          onCheckedChange={(on) => {
            audio.updateClick({ accents: on ? [true] : [] });
          }}
        />
      </label>

      <div className="flex flex-col gap-1">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Volume</span>
          <span className="text-muted-foreground tabular-nums">
            {String(Math.round(settings.volume * 100))} %
          </span>
        </div>
        <Slider
          value={[Math.round(settings.volume * 100)]}
          min={0}
          max={100}
          step={1}
          thumbLabel="Metronome click volume"
          valueText={(value) => `${String(value)} %`}
          onValueChange={([next]) => {
            if (next !== undefined) audio.updateClick({ volume: next / 100 });
          }}
        />
      </div>
    </section>
  );
}
