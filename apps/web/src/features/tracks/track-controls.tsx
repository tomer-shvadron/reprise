import type { Id, Notation, Track } from '@reprise/model';
import { EyeIcon, EyeOffIcon } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { InstrumentLoad } from '@/state/playback';

import { GM_DRUM_KITS, GM_FAMILIES, GM_PROGRAMS } from './gm-programs';
import type { TrackActions } from './track-actions';
import { NOTATION_NAMES, notationChoices, panText, volumeText } from './track-model';

interface Named {
  id: Id;
  label: string;
}

export function MuteToggle({
  id,
  label,
  pressed,
  actions,
}: Named & { pressed: boolean; actions: TrackActions }) {
  return (
    <Toggle
      size="sm"
      aria-label={`Mute ${label}`}
      pressed={pressed}
      className="data-[state=on]:bg-mute data-[state=on]:text-mute-foreground w-7 px-0"
      onPressedChange={() => {
        actions.toggleMute(id);
      }}
    >
      M
    </Toggle>
  );
}

export function SoloToggle({
  id,
  label,
  pressed,
  actions,
}: Named & { pressed: boolean; actions: TrackActions }) {
  return (
    <Toggle
      size="sm"
      aria-label={`Solo ${label}`}
      pressed={pressed}
      className="data-[state=on]:bg-solo data-[state=on]:text-solo-foreground w-7 px-0"
      onPressedChange={() => {
        actions.toggleSolo(id);
      }}
    >
      S
    </Toggle>
  );
}

export function VisibilityToggle({
  id,
  label,
  visible,
  disabledReason,
  actions,
}: Named & { visible: boolean; disabledReason: string | undefined; actions: TrackActions }) {
  const toggle = (
    <Toggle
      size="sm"
      aria-label={`Show ${label}`}
      pressed={visible}
      disabled={disabledReason !== undefined}
      className="w-7 px-0"
      onPressedChange={(next) => {
        actions.setTrackVisible(id, next);
      }}
    >
      {visible ? <EyeIcon /> : <EyeOffIcon />}
    </Toggle>
  );
  if (disabledReason === undefined) return toggle;
  // A disabled button fires no pointer events, so the tooltip hangs on a wrapper.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0}>{toggle}</span>
      </TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}

export function NotationMenu({
  track,
  label,
  notation,
  actions,
}: {
  track: Track;
  label: string;
  notation: Notation;
  actions: TrackActions;
}) {
  const choices = notationChoices(track);
  if (choices.length === 0) return null;
  const short: Record<Notation, string> = { tab: 'Tab', standard: 'Std', both: 'Both' };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={`Notation for ${label}: ${short[notation]}`}
          aria-description={NOTATION_NAMES[notation]}
        >
          {short[notation]}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={notation}
          onValueChange={(value) => {
            const chosen = choices.find((choice) => choice === value);
            if (chosen) actions.setTrackNotation(track.id, chosen);
          }}
        >
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {NOTATION_NAMES[choice]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ChannelSliderProps extends Named {
  name: string;
  value: number;
  text: (value: number) => string;
  spoken: (value: number) => string;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
  showText?: boolean;
}

/** Previews while dragging and commits once, so a drag is one undo step and one layout run. */
function ChannelSlider({
  label,
  name,
  value,
  text,
  spoken,
  onPreview,
  onCommit,
  showText = true,
}: ChannelSliderProps) {
  // A draft remembers the value it was drawn over: Radix commits nothing when a drag ends where it
  // began, so a draft is only shown while the score's value is still the one it started from.
  const [draft, setDraft] = useState<{ value: number; over: number } | undefined>(undefined);
  // Radix reports a keyboard step's change after its commit, which must not leave a draft.
  const committed = useRef<number | undefined>(undefined);
  const shown = draft?.over === value ? draft.value : value;
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Slider
        min={0}
        max={127}
        step={1}
        value={[shown]}
        thumbLabel={`${name} of ${label}`}
        valueText={spoken}
        onValueChange={([next]) => {
          if (next === undefined) return;
          const echo = next === committed.current;
          committed.current = undefined;
          if (!echo) setDraft({ value: next, over: value });
          onPreview(next);
        }}
        onValueCommit={([next]) => {
          setDraft(undefined);
          committed.current = next;
          if (next !== undefined) onCommit(next);
        }}
      />
      {showText && (
        <span className="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
          {text(shown)}
        </span>
      )}
    </div>
  );
}

export function TrackVolume({
  id,
  label,
  volume,
  actions,
  compact = false,
}: Named & { volume: number; actions: TrackActions; compact?: boolean }) {
  return (
    <ChannelSlider
      id={id}
      label={label}
      name="Volume"
      value={volume}
      text={volumeText}
      spoken={volumeText}
      showText={!compact}
      onPreview={(value) => {
        actions.previewVolume(id, value);
      }}
      onCommit={(value) => {
        actions.commitVolume(id, value);
      }}
    />
  );
}

export function TrackPan({
  id,
  label,
  pan,
  actions,
}: Named & { pan: number; actions: TrackActions }) {
  return (
    <ChannelSlider
      id={id}
      label={label}
      name="Pan"
      value={pan}
      text={(value) => panText(value).short}
      spoken={(value) => panText(value).spoken}
      onPreview={(value) => {
        actions.previewPan(id, value);
      }}
      onCommit={(value) => {
        actions.commitPan(id, value);
      }}
    />
  );
}

export function InstrumentSelect({
  track,
  label,
  actions,
}: {
  track: Track;
  label: string;
  actions: TrackActions;
}) {
  const drums = track.kind === 'drums';
  const kits = [...GM_DRUM_KITS];
  const unknownKit = drums && !GM_DRUM_KITS.has(track.program);
  return (
    <select
      aria-label={`Instrument of ${label}`}
      value={track.program}
      className="border-input bg-background h-7 w-full min-w-0 rounded-md border px-1 text-xs"
      onChange={(event) => {
        actions.setProgram(track.id, Number(event.target.value));
      }}
    >
      {drums ? (
        <>
          {unknownKit && <option value={track.program}>Kit {track.program}</option>}
          {kits.map(([program, name]) => (
            <option key={program} value={program}>
              {name}
            </option>
          ))}
        </>
      ) : (
        GM_FAMILIES.map((family, familyIndex) => (
          <optgroup key={family} label={family}>
            {GM_PROGRAMS.slice(familyIndex * 8, familyIndex * 8 + 8).map((name, offset) => (
              <option key={name} value={familyIndex * 8 + offset}>
                {name}
              </option>
            ))}
          </optgroup>
        ))
      )}
    </select>
  );
}

export function InstrumentStatus({ load }: { load: InstrumentLoad | undefined }) {
  if (!load) return null;
  const percent = load.total === 0 ? 0 : Math.round((load.loaded / load.total) * 100);
  return (
    <span role="status" className="text-muted-foreground text-xs">
      Loading sound… {percent}%
    </span>
  );
}
