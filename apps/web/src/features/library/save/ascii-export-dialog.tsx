import { ASCII_TAB_WIDTH } from '@reprise/formats';
import { useId } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

import { libraryOf } from '../library';
import { parseWidth } from './ascii-export';

/** Export as ASCII tab: the tracks, the bars and the line width. A modal; mounted once. */
export function AsciiExportDialog() {
  const exporter = libraryOf(useAppServices()).asciiExport;
  const dialog = useStore(exporter.store, (state) => state.dialog);
  const tracksLabel = useId();
  const barsLabel = useId();
  const widthId = useId();
  const widthHint = useId();
  if (!dialog) return null;
  const width = parseWidth(dialog.widthText);
  const chosen = new Set(dialog.tracks);
  const toggle = (id: string, on: boolean) => {
    exporter.update({
      tracks: dialog.choices.map((c) => c.id).filter((c) => (c === id ? on : chosen.has(c))),
    });
  };
  const canExport = width !== undefined && dialog.tracks.length > 0;
  const { selectedBars } = dialog;
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) exporter.cancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Export as ASCII tab</DialogTitle>
          <DialogDescription>
            Writes plain text you can paste into a forum or an email. It shows voice 1 only, and
            frets and techniques but not rhythm.
          </DialogDescription>
        </DialogHeader>
        <div role="group" aria-labelledby={tracksLabel} className="flex flex-col gap-2">
          <p id={tracksLabel} className="text-sm font-medium">
            Tracks
          </p>
          {dialog.choices.map((choice) => (
            <label
              key={choice.id}
              className={`flex items-center gap-2 text-sm ${choice.fretted ? '' : 'opacity-60'}`}
            >
              <input
                type="checkbox"
                checked={chosen.has(choice.id)}
                disabled={!choice.fretted}
                onChange={(event) => {
                  toggle(choice.id, event.target.checked);
                }}
              />
              <span className="min-w-0 truncate">{choice.name}</span>
              {!choice.fretted && (
                <span className="text-muted-foreground text-xs">
                  No strings: ASCII tab needs a fretted track
                </span>
              )}
            </label>
          ))}
        </div>
        <div role="radiogroup" aria-labelledby={barsLabel} className="flex flex-col gap-2">
          <p id={barsLabel} className="text-sm font-medium">
            Bars
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="ascii-bars"
              checked={dialog.barsMode === 'song'}
              onChange={() => {
                exporter.update({ barsMode: 'song' });
              }}
            />
            Whole song
          </label>
          {selectedBars && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="ascii-bars"
                checked={dialog.barsMode === 'selection'}
                onChange={() => {
                  exporter.update({ barsMode: 'selection' });
                }}
              />
              {selectedBars.first === selectedBars.last
                ? `Selected bar ${String(selectedBars.first)}`
                : `Selected bars ${String(selectedBars.first)}–${String(selectedBars.last)}`}
            </label>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={widthId} className="text-sm font-medium">
            Line width
          </label>
          <Input
            id={widthId}
            type="number"
            inputMode="numeric"
            min={ASCII_TAB_WIDTH.min}
            max={ASCII_TAB_WIDTH.max}
            value={dialog.widthText}
            aria-invalid={width === undefined}
            aria-describedby={widthHint}
            className="w-24"
            onChange={(event) => {
              exporter.update({ widthText: event.target.value });
            }}
          />
        </div>
        <p
          id={widthHint}
          className={`text-xs ${width === undefined ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {`Characters per line, ${String(ASCII_TAB_WIDTH.min)} to ${String(ASCII_TAB_WIDTH.max)}.`}
        </p>
        {dialog.error && (
          <p role="alert" className="text-destructive text-sm">
            {dialog.error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              exporter.cancel();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={!canExport}
            onClick={() => {
              void exporter.submit();
            }}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
