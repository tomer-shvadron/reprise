import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { Slider } from '@/components/ui/slider';
import { startPositionReader } from '@/state/position-reader';
import { timelineOf, writtenBpmAt } from '@/state/timeline';

import { TransportButton } from './controls';
import { bpmFor, parseBpm, percentForBpm, percentOf, TEMPO_PERCENT } from './tempo';
import { useCommand } from './use-command';

/** The BPM field, the speed slider and the relative-speed button, linked through one percent. */
export function TempoControl() {
  const services = useAppServices();
  const { playback, document, audio, transport } = services;
  const tempo = useStore(playback, (state) => state.settings.tempo);
  const hasScore = useStore(document, (state) => state.score !== undefined);
  const remembered = useStore(transport, (state) => state.rememberedSpeed);
  const focus = useStore(transport, (state) => state.focus);
  const setTempoCommand = useCommand('transport.setTempo');

  const [bpm, setBpm] = useState<number | undefined>(undefined);
  const [draft, setDraftState] = useState<string | undefined>(undefined);
  // Read by the blur that follows Enter or Escape in the same task, before React re-renders.
  const draftRef = useRef<string | undefined>(undefined);
  const setDraft = (value: string | undefined) => {
    draftRef.current = value;
    setDraftState(value);
  };
  const input = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<Element | null>(null);
  const reader = useRef<{ refresh(): void } | undefined>(undefined);

  // The written tempo moves with the playhead through tempo marks, so the reader feeds it.
  useLayoutEffect(() => {
    let shown: number | undefined;
    const started = startPositionReader(playback, (event) => {
      const { score } = document.getState();
      let next: number | undefined;
      if (score) {
        const written = writtenBpmAt(timelineOf(score), event);
        next = bpmFor(percentOf(playback.getState().settings.tempo, written), written);
      }
      if (next !== shown) {
        shown = next;
        setBpm(next);
      }
    });
    const unsubscribe = document.subscribe((state, previous) => {
      if (state.score !== previous.score) started.refresh();
    });
    reader.current = started;
    return () => {
      unsubscribe();
      started.stop();
      reader.current = undefined;
    };
  }, [playback, document]);

  useEffect(() => {
    reader.current?.refresh();
  }, [tempo]);

  useEffect(() => {
    if (focus?.target !== 'tempo') return;
    input.current?.focus();
    input.current?.select();
  }, [focus]);

  const written = () => {
    const { score } = document.getState();
    return score ? writtenBpmAt(timelineOf(score), playback.getState().position) : undefined;
  };
  const percent = percentOf(tempo, written() ?? 100);

  const commitBpm = (value: number) => {
    const base = written();
    if (base === undefined) return;
    audio.setTempo('percent', percentForBpm(value, base));
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

  return (
    <div role="group" aria-label="Tempo" className="flex items-center gap-2">
      <InputGroup className="h-7 w-auto" data-command="transport.setTempo">
        <InputGroupInput
          ref={input}
          inputMode="numeric"
          aria-label="Tempo in BPM"
          aria-keyshortcuts={setTempoCommand.ariaKeys}
          title={setTempoCommand.keys && `${setTempoCommand.title} (${setTempoCommand.keys})`}
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
        <InputGroupAddon align="inline-end">
          <InputGroupText className="text-xs">BPM</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <div className="hidden w-20 items-center lg:flex" data-command="transport.speedUp">
        <Slider
          value={[percent]}
          min={TEMPO_PERCENT.min}
          max={TEMPO_PERCENT.max}
          step={1}
          disabled={!hasScore}
          thumbLabel="Speed"
          valueText={(value) => `${String(Math.round(value))}%`}
          onValueChange={([value]) => {
            if (value !== undefined) audio.setTempo('percent', value);
          }}
        />
      </div>
      <TransportButton
        command="transport.toggleSpeed"
        label={speedLabel}
        tip="Toggle relative speed"
        size="sm"
        className="min-w-[6ch] tabular-nums"
        aria-label={undefined}
        aria-pressed={Math.round(percent) !== TEMPO_PERCENT.default}
        disabled={
          !hasScore || (Math.round(percent) === TEMPO_PERCENT.default && remembered === undefined)
        }
      >
        <span className="sr-only">Relative speed </span>
        {speedLabel}
      </TransportButton>
    </div>
  );
}
