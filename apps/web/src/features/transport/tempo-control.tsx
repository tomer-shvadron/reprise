import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { CommandTooltip, HintTooltip, ShortcutKeys } from '@/app/command-tooltip';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useAppServices } from '@/app/services-context';
import { useCommand, type BoundCommand } from '@/app/use-command';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { startPositionReader, type PositionReader } from '@/state/position-reader';
import { timelineOf, writtenBpmAt } from '@/state/timeline';

import { TransportButton } from './controls';
import {
  bpmFor,
  clampBpm,
  clampPercent,
  isFixed,
  parseBpm,
  percentForBpm,
  percentOf,
  TEMPO_PERCENT,
} from './tempo';

/** The slider's step keys in its tooltip, "Slower [, Faster ]", each only while it is bound. */
function SpeedStepKeys({ slower, faster }: { slower: BoundCommand; faster: BoundCommand }) {
  return (
    <>
      {slower.bindings.length > 0 && (
        <span className="inline-flex items-center gap-1">
          Slower
          <ShortcutKeys bindings={slower.bindings} platform={slower.keyboard} />
        </span>
      )}
      {faster.bindings.length > 0 && (
        <span className="inline-flex items-center gap-1">
          Faster
          <ShortcutKeys bindings={faster.bindings} platform={faster.keyboard} />
        </span>
      )}
    </>
  );
}

/** The BPM field, the speed slider and the relative-speed button, linked through one percent. */
export function TempoControl() {
  const services = useAppServices();
  const { playback, document, audio, transport } = services;
  const tempo = useStore(playback, (state) => state.settings.tempo);
  const hasScore = useStore(document, (state) => state.score !== undefined);
  const fixed = isFixed(tempo);
  const remembered = useStore(transport, (state) => state.rememberedSpeed);
  const focus = useStore(transport, (state) => state.focus);
  const slowDown = useCommand('transport.slowDown');
  const speedUp = useCommand('transport.speedUp');
  const menu = useStaticContextMenu({
    surface: 'transport.tempo',
    target: { kind: 'transport', control: 'tempo' },
    label: 'Tempo',
  });
  const stepKeys = [slowDown.ariaKeys, speedUp.ariaKeys].filter(Boolean).join(' ') || undefined;

  const [written, setWritten] = useState<number | undefined>(undefined);
  const [draft, setDraftState] = useState<string | undefined>(undefined);
  // Read by the blur that follows Enter or Escape in the same task, before React re-renders.
  const draftRef = useRef<string | undefined>(undefined);
  const setDraft = (value: string | undefined) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const readerRef = useRef<PositionReader | undefined>(undefined);

  // The written tempo moves with the playhead through tempo marks, so the reader feeds it; React
  // renders only when it changes, which a constant section never does.
  useLayoutEffect(() => {
    const read = () => {
      const { score } = document.getState();
      return score ? writtenBpmAt(timelineOf(score), playback.getState().position) : undefined;
    };
    let last: number | undefined;
    const reader = startPositionReader(playback, () => {
      const next = read();
      // Within a ramp the written tempo moves every frame; only a new displayed integer renders.
      const display = (w: number | undefined) =>
        w === undefined ? undefined : bpmFor(percentOf(playback.getState().settings.tempo, w), w);
      if (last !== undefined && next !== undefined && display(next) === display(last)) return;
      last = next;
      setWritten(next);
    });
    readerRef.current = reader;
    const unsubscribe = document.subscribe((state, previous) => {
      if (state.score !== previous.score) reader.refresh();
    });
    return () => {
      unsubscribe();
      reader.stop();
      readerRef.current = undefined;
    };
  }, [playback, document]);

  // The reader skipped a written tempo whose display matched at the old speed; at the new one it
  // may not, so a paused field would otherwise keep the old mark's BPM.
  useLayoutEffect(() => {
    readerRef.current?.refresh();
  }, [tempo]);

  useEffect(() => {
    if (focus?.target !== 'tempo') return;
    input.current?.focus();
    input.current?.select();
  }, [focus]);

  const percent = percentOf(tempo, written ?? 100);
  const bpm = written === undefined ? undefined : bpmFor(percent, written);

  const commitBpm = (value: number) => {
    const { score } = document.getState();
    if (!score) return;
    // Fresh from the store: the state can trail the playhead by a frame.
    const base = writtenBpmAt(timelineOf(score), playback.getState().position);
    // Fixed tempo takes the typed BPM as it is; otherwise it becomes a percent of the written one.
    if (fixed) audio.setTempo('bpm', clampBpm(value));
    else audio.setTempo('percent', percentForBpm(value, base));
  };

  const commitDraft = () => {
    const current = draftRef.current;
    const value = current === undefined ? undefined : parseBpm(current);
    if (value !== undefined && value !== bpm) commitBpm(value);
    setDraft(undefined);
  };

  const leave = () => {
    const target = returnFocus.current;
    returnFocus.current = null;
    if (target instanceof HTMLElement && target.isConnected) target.focus();
    else input.current?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
      leave();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(undefined);
      leave();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const current = draftRef.current;
      const base = (current !== undefined ? parseBpm(current) : undefined) ?? bpm;
      if (base === undefined) return;
      const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
      commitBpm(base + step);
      setDraft(undefined);
      input.current?.select();
    }
  };

  const speedLabel = `${String(Math.round(percent))}%`;
  // In fixed tempo the percent is only a derived number that moves at every tempo mark, so the
  // disabled slider rests at 100 and the button shows a dash and is not pressed.
  const sliderPercent = fixed ? TEMPO_PERCENT.default : clampPercent(percent);

  return (
    <div {...menu} role="group" aria-label="Tempo" className="flex items-center gap-2">
      <InputGroup className="h-7 w-auto" data-command="transport.setTempo">
        {/* Hover only: a tooltip opening on focus would cover the number being typed. */}
        <CommandTooltip
          command="transport.setTempo"
          label="Quarter notes per minute"
          openOnFocus={false}
        >
          <InputGroupInput
            ref={input}
            inputMode="numeric"
            aria-label="Tempo in BPM"
            placeholder="–"
            disabled={!hasScore}
            className="w-10 text-right tabular-nums"
            value={draft ?? (bpm === undefined ? '' : String(bpm))}
            onFocus={(event) => {
              returnFocus.current = event.relatedTarget;
              setDraft(bpm === undefined ? '' : String(bpm));
              event.currentTarget.select();
            }}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
            onBlur={commitDraft}
            onKeyDown={onKeyDown}
          />
        </CommandTooltip>
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs">BPM</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {fixed && (
        <span
          className="text-muted-foreground text-xs font-medium"
          id="fixed-tempo-note"
          data-testid="fixed-tempo-marker"
        >
          Fixed <span className="sr-only">tempo is on, so the speed slider is off</span>
        </span>
      )}
      <HintTooltip
        spoken={
          fixed
            ? 'Fixed tempo is on'
            : [
                'Speed',
                slowDown.spoken && `slower ${slowDown.spoken}`,
                speedUp.spoken && `faster ${speedUp.spoken}`,
              ]
                .filter(Boolean)
                .join(', ')
        }
        label={
          fixed ? (
            'Fixed tempo is on'
          ) : (
            <>
              Speed
              <SpeedStepKeys slower={slowDown} faster={speedUp} />
            </>
          )
        }
      >
        <div
          className="hidden w-20 items-center lg:flex"
          data-commands="transport.slowDown transport.speedUp"
        >
          <Slider
            value={[sliderPercent]}
            min={TEMPO_PERCENT.min}
            max={TEMPO_PERCENT.max}
            step={1}
            disabled={!hasScore || fixed}
            thumbLabel="Speed"
            thumbKeys={stepKeys}
            thumbDescribedBy={fixed ? 'fixed-tempo-note' : undefined}
            valueText={(value) => `${String(Math.round(value))}%`}
            onValueChange={([value]) => {
              if (value !== undefined) audio.setTempo('percent', value);
            }}
          />
        </div>
      </HintTooltip>
      <TransportButton
        command="transport.toggleSpeed"
        label={fixed ? '–' : speedLabel}
        tip="Toggle relative speed"
        size="sm"
        className="min-w-[6ch] tabular-nums"
        aria-label={undefined}
        aria-pressed={!fixed && Math.round(percent) !== TEMPO_PERCENT.default}
        disabled={
          !hasScore ||
          fixed ||
          (Math.round(percent) === TEMPO_PERCENT.default && remembered === undefined)
        }
      >
        <span className="sr-only">Relative speed </span>
        {fixed ? '–' : speedLabel}
      </TransportButton>
    </div>
  );
}
