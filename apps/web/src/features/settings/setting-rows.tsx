import { useId, useState, type ReactNode } from 'react';

import { useAppServices } from '@/app/services-context';
import { useSetting } from '@/app/use-setting';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import type { SettingDef } from '@/state/settings';

/** A label on the left with an optional muted description, the control on the right. */
export function SettingRow({
  label,
  description,
  htmlFor,
  labelId,
  children,
}: {
  label: string;
  description?: string;
  htmlFor?: string;
  labelId?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <label id={labelId} htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-muted-foreground mt-0.5 text-xs">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SwitchSetting({
  def,
  label,
  description,
}: {
  def: SettingDef<boolean>;
  label: string;
  description?: string;
}) {
  const { settings } = useAppServices();
  const value = useSetting(def);
  const id = useId();
  return (
    <SettingRow label={label} {...(description && { description })} htmlFor={id}>
      <Switch
        id={id}
        checked={value}
        onCheckedChange={(next) => {
          settings.set(def, next);
        }}
      />
    </SettingRow>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
}

/** One choice of a few, shown as a segmented group; a second click on the pressed one does nothing. */
export function ChoiceSetting<T extends string>({
  def,
  label,
  description,
  choices,
}: {
  def: SettingDef<T>;
  label: string;
  description?: string;
  choices: readonly Choice<T>[];
}) {
  const { settings } = useAppServices();
  const value = useSetting(def);
  const labelId = useId();
  return (
    <SettingRow label={label} {...(description && { description })} labelId={labelId}>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={value}
        aria-labelledby={labelId}
        onValueChange={(next) => {
          // Radix sends '' when the pressed item is pressed again.
          const choice = choices.find((candidate) => candidate.value === next);
          if (choice) settings.set(def, choice.value);
        }}
      >
        {choices.map((choice) => (
          <ToggleGroupItem
            key={choice.value}
            value={choice.value}
            className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground px-3"
          >
            {choice.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </SettingRow>
  );
}

/** A slider over `min` to `max`, shown as a percentage; written when the drag ends. */
export function SliderSetting({
  def,
  label,
  description,
  min,
  max,
  step,
}: {
  def: SettingDef<number>;
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
}) {
  const { settings } = useAppServices();
  const value = useSetting(def);
  const percent = (n: number) => `${String(Math.round(n * 100))}%`;
  return (
    <SettingRow label={label} {...(description && { description })}>
      <SliderBody
        value={value}
        label={label}
        min={min}
        max={max}
        step={step}
        format={percent}
        onCommit={(next) => {
          settings.set(def, next);
        }}
      />
    </SettingRow>
  );
}

function SliderBody({
  value,
  label,
  min,
  max,
  step,
  format,
  onCommit,
}: {
  value: number;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  onCommit: (n: number) => void;
}) {
  // The thumb follows the drag; the setting is written once, on release or a key step.
  const [live, setLive] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setLive(value);
  }
  return (
    <div className="flex w-56 items-center gap-3">
      <Slider
        min={min}
        max={max}
        step={step}
        value={[live]}
        thumbLabel={label}
        valueText={format}
        onValueChange={([next]) => {
          if (next !== undefined) setLive(next);
        }}
        onValueCommit={([next]) => {
          if (next !== undefined) onCommit(next);
        }}
      />
      <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
        {format(live)}
      </span>
    </div>
  );
}
