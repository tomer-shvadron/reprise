import { useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { CommandTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { parseBpm } from '@/features/transport';

import { beatName, clampBeats, DENOMINATORS, isCompound, MAX_BEATS } from './meter';
import { metronomeFor } from './metronome-store';
import { addTap, CLICK_BPM, clampClickBpm, tapBpm } from './tap-tempo';

type Subdivision = 1 | 2 | 3 | 4;

/** Relative to the beat, so they are right in every meter. */
const SUBDIVISIONS: { value: Subdivision; label: string }[] = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];

/** A number field that edits a draft and commits on Enter or blur, reverts on Escape, steps on arrows. */
function DraftField({
  id,
  label,
  value,
  suffix,
  min,
  max,
  parse,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  suffix?: string;
  min: number;
  max: number;
  parse: (text: string) => number | undefined;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const commit = () => {
    const parsed = draft === undefined ? undefined : parse(draft);
    if (parsed !== undefined && parsed >= min && parsed <= max && parsed !== value) {
      onCommit(parsed);
    }
    setDraft(undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDraft(undefined);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      onCommit(Math.min(max, Math.max(min, value + step)));
      setDraft(undefined);
    }
  };
  return (
    <InputGroup className="h-7 w-24">
      <InputGroupInput
        id={id}
        aria-label={label}
        inputMode="decimal"
        className="text-right tabular-nums"
        value={draft ?? String(value)}
        onFocus={(event) => {
          event.currentTarget.select();
        }}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {suffix && (
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs">{suffix}</InputGroupText>
        </InputGroupAddon>
      )}
    </InputGroup>
  );
}

/** A standalone click: no song needed, because the audio service owns a score-less click path. */
export function MetronomePanel() {
  const services = useAppServices();
  const { audio, playback } = services;
  const { running, settings } = useStore(playback, (state) => state.click);
  const meter = useStore(metronomeFor(services));
  const toggle = useCommand('trainer.metronomeToggle');
  const [taps, setTaps] = useState<number[]>([]);

  const setBpm = (bpm: number) => {
    audio.updateClick({ bpm: clampClickBpm(bpm) });
  };
  const tap = (time: number) => {
    const next = addTap(taps, time);
    setTaps(next);
    const bpm = tapBpm(next);
    if (bpm !== undefined) setBpm(bpm);
  };
  const accented = settings.accents.length > 0 && settings.accents[0] === true;

  return (
    <section aria-label="Metronome" className="flex flex-col gap-3 p-3 text-sm">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Metronome
      </h2>

      <CommandTooltip command="trainer.metronomeToggle" label={toggle.title} whenUnbound="none">
        <Button size="sm" variant={running ? 'default' : 'outline'} onClick={toggle.run}>
          {running ? 'Stop' : 'Start'}
        </Button>
      </CommandTooltip>

      <div className="flex flex-col gap-1">
        <label htmlFor="metronome-bpm" className="text-muted-foreground text-xs">
          Tempo, BPM of the {beatName(meter)} note
        </label>
        <div className="flex items-center gap-2">
          <DraftField
            id="metronome-bpm"
            label="Tempo"
            value={settings.bpm}
            suffix="BPM"
            min={CLICK_BPM.min}
            max={CLICK_BPM.max}
            parse={parseBpm}
            onCommit={setBpm}
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
          thumbLabel="Tempo slider"
          valueText={(value) => `${String(value)} BPM`}
          onValueChange={([next]) => {
            if (next !== undefined) setBpm(next);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Time signature</span>
        <div className="flex items-center gap-2">
          <DraftField
            id="metronome-beats"
            label="Beats per bar"
            value={meter.numerator}
            min={1}
            max={MAX_BEATS}
            parse={(text) => {
              const value = parseBpm(text);
              return value === undefined ? undefined : clampBeats(value);
            }}
            onCommit={meter.setNumerator}
          />
          <span aria-hidden="true">/</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Beat note"
            value={String(meter.denominator)}
            onValueChange={(value) => {
              const next = DENOMINATORS.find((d) => String(d) === value);
              if (next) meter.setDenominator(next);
            }}
          >
            {DENOMINATORS.map((d) => (
              <ToggleGroupItem key={d} value={String(d)}>
                {String(d)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {isCompound(meter) && (
          <label className="flex items-center justify-between gap-2">
            <span>Count in dotted quarters</span>
            <Switch checked={meter.dotted} onCheckedChange={meter.setDotted} />
          </label>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Clicks per beat</span>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Clicks per beat"
          value={String(settings.subdivision)}
          onValueChange={(value) => {
            const next = SUBDIVISIONS.find((s) => String(s.value) === value);
            if (next) audio.updateClick({ subdivision: next.value });
          }}
        >
          {SUBDIVISIONS.map((s) => (
            <ToggleGroupItem
              key={s.value}
              value={String(s.value)}
              aria-label={s.value === 3 ? '3 per beat (triplets)' : `${String(s.value)} per beat`}
            >
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
