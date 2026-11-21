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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { bpmFor, loopBarNumbers, parseBpm, TEMPO_PERCENT } from '@/features/transport';

import {
  convertConfig,
  displayValue,
  rampProgress,
  REPS,
  toPercent,
  type OnMiss,
  type RampUnit,
} from './ramp';
import { speedTrainerFor } from './speed-trainer-for';
import { referenceBpmFor } from './speed-trainer-store';

type NumberKey = 'start' | 'step' | 'target';

/** A value in the field's unit, or undefined when it cannot be used. */
function parseValue(text: string, unit: RampUnit, key: NumberKey, referenceBpm: number) {
  const value = parseBpm(text);
  if (value === undefined) return undefined;
  const percent = toPercent(value, unit, referenceBpm);
  const range = key === 'step' ? { min: 0, max: TEMPO_PERCENT.max } : TEMPO_PERCENT;
  const inRange =
    key === 'step'
      ? percent > 0 && percent <= range.max
      : percent >= range.min - 0.5 && percent <= range.max + 0.5;
  return inRange ? value : undefined;
}

function NumberField({
  id,
  label,
  value,
  suffix,
  disabled,
  parse,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  suffix: string;
  disabled: boolean;
  parse: (text: string) => number | undefined;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const commit = () => {
    const parsed = draft === undefined ? undefined : parse(draft);
    if (parsed !== undefined && parsed !== value) onCommit(parsed);
    setDraft(undefined);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      setDraft(undefined);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </label>
      <InputGroup className="h-7">
        <InputGroupInput
          id={id}
          inputMode="decimal"
          disabled={disabled}
          className="text-right tabular-nums"
          value={draft ?? displayValue(value)}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
          }}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs">{suffix}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

/** The speed trainer: set a ramp over the loop, start it, and follow it step by step. */
export function SpeedTrainerPanel() {
  const services = useAppServices();
  const { document, playback } = services;
  const trainer = speedTrainerFor(services);
  const state = useStore(trainer);
  const score = useStore(document, (s) => s.score);
  const loop = useStore(playback, (s) => s.settings.loop);
  const toggle = useCommand('trainer.speedTrainerToggle');
  const missed = useCommand('trainer.speedTrainerMissed');
  const reset = useCommand('trainer.speedTrainerReset');
  const toggleLoop = useCommand('transport.toggleLoop');
  const { config, status, plan } = state;
  const active = status === 'running' || status === 'held';
  const hasRun = status !== 'idle' && plan !== undefined;
  const range = active || hasRun ? (state.range ?? loop) : loop;
  const bars = range && loopBarNumbers(score, range);
  // Live from the loop while setting up, frozen at Start for the run's own readout.
  const referenceBpm = hasRun ? (state.referenceBpm ?? 120) : referenceBpmFor(services, loop);
  const unit = config.unit;
  const suffix = unit === 'percent' ? '%' : 'BPM';
  const canStart = score !== undefined && loop !== undefined;

  const percent = plan?.percents[state.stepIndex];
  const next = plan?.percents[state.stepIndex + 1];
  const steps = plan?.percents.length ?? 0;
  const fraction = rampProgress(plan, state.stepIndex, status);
  const describe = (value: number) =>
    `${String(Math.round(value))} % · ${String(bpmFor(value, referenceBpm))} BPM`;

  const statusText = { idle: '', running: 'Running', held: 'Held', done: 'Done' }[status];
  const toggleLabel = { idle: 'Start', running: 'Hold', held: 'Resume', done: 'Start again' }[
    status
  ];

  const numberField = (key: NumberKey, label: string) => (
    <NumberField
      id={`speed-trainer-${key}`}
      label={label}
      value={config[key]}
      suffix={suffix}
      disabled={active}
      parse={(text) => parseValue(text, unit, key, referenceBpm)}
      onCommit={(value) => {
        state.setConfig({ [key]: value });
      }}
    />
  );

  return (
    <section aria-label="Speed trainer" className="flex flex-col gap-3 p-3 text-sm">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Speed trainer
      </h2>

      <div className="flex flex-col gap-1">
        <p data-testid="speed-trainer-loop">
          {bars
            ? bars.start === bars.end
              ? `Bar ${String(bars.start)}`
              : `Bars ${String(bars.start)}–${String(bars.end)}`
            : 'Select bars and loop them to train'}
        </p>
        {!loop && score && (
          <CommandTooltip
            command="transport.toggleLoop"
            label="Loops the selected bars, else the clicked bar while the playhead is in it, else the whole song"
          >
            <Button variant="outline" size="sm" className="w-fit" onClick={toggleLoop.run}>
              Loop selection
            </Button>
          </CommandTooltip>
        )}
        {loop && (
          <p className="text-muted-foreground text-xs">
            Written tempo at bar {String(bars?.start ?? 1)}: {String(Math.round(referenceBpm))} BPM
          </p>
        )}
      </div>

      <fieldset disabled={active} className="flex flex-col gap-2 disabled:opacity-60">
        <legend className="sr-only">Setup</legend>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Unit"
          value={unit}
          disabled={active}
          onValueChange={(value) => {
            if (value !== 'percent' && value !== 'bpm') return;
            state.setConfig(convertConfig(config, value, referenceBpm));
          }}
        >
          <ToggleGroupItem value="percent">Percent</ToggleGroupItem>
          <ToggleGroupItem value="bpm">BPM</ToggleGroupItem>
        </ToggleGroup>
        <div className="grid grid-cols-3 gap-2">
          {numberField('start', 'Start')}
          {numberField('step', 'Step')}
          {numberField('target', 'Target')}
        </div>
        <NumberField
          id="speed-trainer-reps"
          label="Repetitions per step"
          value={config.repsPerStep}
          suffix="×"
          disabled={active}
          parse={(text) => {
            const value = Number(text.trim());
            return Number.isInteger(value) && value >= REPS.min && value <= REPS.max
              ? value
              : undefined;
          }}
          onCommit={(value) => {
            state.setConfig({ repsPerStep: value });
          }}
        />
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">On a miss</span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="On a miss"
            value={config.onMiss}
            disabled={active}
            onValueChange={(value) => {
              if (value === 'repeat' || value === 'stepDown') {
                state.setConfig({ onMiss: value satisfies OnMiss });
              }
            }}
          >
            <ToggleGroupItem value="repeat">Repeat step</ToggleGroupItem>
            <ToggleGroupItem value="stepDown">Step down</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </fieldset>

      {hasRun && percent !== undefined && (
        <div className="flex flex-col gap-1" aria-label="Progress" role="group">
          <p className="text-2xl font-medium tabular-nums" data-testid="speed-trainer-tempo">
            {Math.round(percent)} %{' '}
            <span className="text-muted-foreground text-base">
              {bpmFor(percent, referenceBpm)} BPM
            </span>
          </p>
          <p>
            Step {state.stepIndex + 1} of {steps}
          </p>
          {status !== 'done' && (
            <p className="flex items-center gap-2">
              <span>
                Pass {Math.min(state.reps + 1, config.repsPerStep)} of {config.repsPerStep}
              </span>
              <span aria-hidden className="flex gap-1">
                {Array.from({ length: config.repsPerStep }, (_, index) => (
                  <span
                    key={index}
                    className={`size-2 rounded-full ${index < state.reps ? 'bg-primary' : 'bg-muted'}`}
                  />
                ))}
              </span>
            </p>
          )}
          <p className="text-muted-foreground">
            {next === undefined ? 'Target reached' : `Next: ${describe(next)}`}
          </p>
          <div
            role="progressbar"
            aria-label="Progress to target"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(fraction * 100)}
            aria-valuetext={`Step ${String(state.stepIndex + 1)} of ${String(steps)}, ${describe(percent)}`}
            className="bg-muted h-1.5 overflow-hidden rounded-full"
          >
            <div className="bg-primary h-full" style={{ width: `${String(fraction * 100)}%` }} />
          </div>
          <p role="status" className="text-muted-foreground text-xs">
            {statusText}
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <CommandTooltip
          command="trainer.speedTrainerToggle"
          label={toggle.title}
          whenUnbound="none"
          {...(!canStart && !active && { reason: 'Loop some bars first' })}
        >
          <Button
            size="sm"
            onClick={toggle.run}
            disabled={status !== 'running' && status !== 'held' && !canStart}
          >
            {toggleLabel}
          </Button>
        </CommandTooltip>
        <CommandTooltip
          command="trainer.speedTrainerMissed"
          label={missed.title}
          whenUnbound="none"
        >
          <Button variant="outline" size="sm" onClick={missed.run} disabled={status !== 'running'}>
            Missed pass
          </Button>
        </CommandTooltip>
        <CommandTooltip command="trainer.speedTrainerReset" label={reset.title} whenUnbound="none">
          <Button variant="outline" size="sm" onClick={reset.run} disabled={status === 'idle'}>
            Reset
          </Button>
        </CommandTooltip>
      </div>
    </section>
  );
}
