import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group';
import { selectRunning } from '@/state/playback';

import { CentsMeter, clampCents, formatCents, METER_RANGE } from './cents-meter';
import { isValidReference, nearestNote, noteLabel, REFERENCE_HZ } from './notes';
import { StringPicker } from './string-picker';
import { stringTargets } from './strings';
import { tunerFor } from './tuner-for';

function ReferenceField({ value, onCommit }: { value: number; onCommit: (hz: number) => void }) {
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const commit = () => {
    const parsed = draft === undefined ? undefined : Number(draft.trim());
    if (parsed !== undefined && isValidReference(parsed) && parsed !== value) onCommit(parsed);
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
      <label htmlFor="tuner-reference" className="text-muted-foreground text-xs">
        Reference (A4)
      </label>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Lower the reference"
          disabled={value <= REFERENCE_HZ.min}
          onClick={() => {
            onCommit(value - 1);
          }}
        >
          −
        </Button>
        <InputGroup className="h-7 w-24">
          <InputGroupInput
            id="tuner-reference"
            inputMode="numeric"
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
          <InputGroupAddon align="inline-end">
            <InputGroupText className="text-xs">Hz</InputGroupText>
          </InputGroupAddon>
        </InputGroup>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Raise the reference"
          disabled={value >= REFERENCE_HZ.max}
          onClick={() => {
            onCommit(value + 1);
          }}
        >
          +
        </Button>
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

/** The tuner: listens through the microphone while the panel is open and Start is on. */
export function TunerPanel() {
  const services = useAppServices();
  const { document, selection, playback } = services;
  const tuner = tunerFor(services);
  const state = useStore(tuner);
  const score = useStore(document, (s) => s.score);
  const currentTrack = useStore(selection, (s) => s.currentTrack);
  const playing = useStore(playback, selectRunning);
  const toggle = useCommand('trainer.tunerToggle');

  // Capture runs only while this panel is mounted.
  useEffect(() => tuner.getState().attach(), [tuner]);

  const track = score?.tracks.find((candidate) => candidate.id === currentTrack);
  const set = useMemo(() => stringTargets(track, state.referenceHz), [track, state.referenceHz]);
  const { reading, status, error, override, autoString } = state;

  const highlighted = override ?? (reading ? autoString : undefined);
  const target = set?.targets.find((candidate) => candidate.string === highlighted);
  const nearest = reading ? nearestNote(reading.midi) : undefined;
  const targetMidi = target?.midi ?? nearest?.midi;
  const cents = reading && targetMidi !== undefined ? (reading.midi - targetMidi) * 100 : undefined;
  const label = targetMidi === undefined ? '' : noteLabel(targetMidi).text;
  const inTune = Boolean(reading?.inTune) && nearest?.midi === targetMidi;
  const shown = nearest ? noteLabel(nearest.midi) : undefined;
  const beyond = cents !== undefined && Math.abs(cents) > METER_RANGE;
  const semitones = cents === undefined ? 0 : Math.round(cents / 100);

  const listening = status === 'listening' || status === 'starting';
  const buttonLabel = error ? 'Try again' : listening ? 'Stop' : 'Start';
  const statusText =
    status === 'starting'
      ? 'Waiting for the microphone…'
      : status === 'listening' && !reading
        ? 'Play a string'
        : status === 'idle' && !error
          ? 'Click Start to listen.'
          : '';
  const announcement = shown ? `${shown.text}${inTune ? ', in tune' : ''}` : '';

  return (
    <section aria-label="Tuner" className="flex flex-col gap-3 p-3 text-sm">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Tuner</h2>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={toggle.run}
          disabled={error?.retry === false}
          title={toggle.keys ? `${toggle.title} (${toggle.keys})` : toggle.title}
          aria-keyshortcuts={toggle.ariaKeys}
        >
          {buttonLabel}
        </Button>
        {statusText && <p className="text-muted-foreground text-xs">{statusText}</p>}
      </div>

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error.message}
        </p>
      )}

      {playing && listening && (
        <p className="text-muted-foreground text-xs">
          The song is playing. Use headphones, or the tuner may hear it.
        </p>
      )}

      <div
        className={`flex flex-col items-center gap-1 ${reading?.held ? 'opacity-50' : ''}`}
        data-testid="tuner-note"
        data-held={reading?.held ?? false}
      >
        <p
          className={`text-6xl leading-none font-medium ${inTune ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
          aria-label={shown?.text ?? 'No note'}
        >
          {shown ? (
            <>
              <span>{shown.letter}</span>
              <span className="text-3xl">{shown.accidental}</span>
              <span className="text-muted-foreground text-2xl">{shown.octave}</span>
            </>
          ) : (
            <span className="text-muted-foreground">–</span>
          )}
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {reading ? `${reading.hz.toFixed(1)} Hz` : ' '}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <CentsMeter cents={cents} label={label} inTune={inTune} held={reading?.held ?? false} />
        <p
          data-testid="tuner-cents"
          className={`w-12 shrink-0 text-right text-lg tabular-nums ${inTune ? 'text-emerald-600 dark:text-emerald-400' : ''}`}
        >
          {cents === undefined ? '' : formatCents(clampCents(cents))}
        </p>
      </div>
      <p className="text-muted-foreground min-h-4 text-center text-xs">
        {inTune
          ? 'In tune'
          : beyond
            ? `${cents < 0 ? 'Tune up' : 'Tune down'} (${semitones < 0 ? '−' : '+'}${plural(Math.abs(semitones), 'semitone')})`
            : ''}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {set && (
        <StringPicker
          set={set}
          highlighted={highlighted}
          override={override}
          onSelect={(string) => {
            tuner.getState().selectString(string);
          }}
        />
      )}

      <ReferenceField
        value={state.referenceHz}
        onCommit={(hz) => {
          tuner.getState().setReference(hz);
        }}
      />
    </section>
  );
}
