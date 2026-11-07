import { useId } from 'react';
import { useStore } from 'zustand';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import type { PrintSettings } from './print-layout';
import type { PrintStore } from './print-store';
import type { PaperSize } from './view-options';

function isPaper(value: string): value is PaperSize {
  return value === 'a4' || value === 'letter';
}

function SwitchRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="min-w-0 truncate text-sm">
        {label}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Our print options, before the system dialog: the tracks and the paper decide the layout, which
 * the system dialog cannot redo. Unmounted, not hidden, while printing, so no scroll lock or
 * `aria-hidden` stays on the page Chromium paginates.
 */
export function PrintDialog({ store }: { store: PrintStore }) {
  const dialog = useStore(store, (state) => state.dialog);
  const preparing = useStore(store, (state) => state.preparing);
  if (!dialog) return null;
  const { settings, choices, error } = dialog;
  const update = (change: Partial<PrintSettings>) => {
    store.getState().update(change);
  };
  const cancel = () => {
    store.getState().cancel();
  };
  const chosen = new Set(settings.tracks);
  const toggleTrack = (id: string, on: boolean) => {
    update({ tracks: choices.map((c) => c.id).filter((c) => (c === id ? on : chosen.has(c))) });
  };
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Print</DialogTitle>
          <DialogDescription>
            Each track prints in the notation it shows. Choose the printer in the next dialog.
          </DialogDescription>
        </DialogHeader>
        {choices.length > 1 && (
          <div role="group" aria-label="Tracks" className="flex flex-col gap-2">
            <p className="text-sm font-medium">Tracks</p>
            {choices.map((choice) => (
              <SwitchRow
                key={choice.id}
                label={choice.name}
                checked={chosen.has(choice.id)}
                disabled={preparing}
                onChange={(on) => {
                  toggleTrack(choice.id, on);
                }}
              />
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">Paper</p>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-label="Paper"
            value={settings.paper}
            disabled={preparing}
            onValueChange={(value) => {
              if (isPaper(value)) update({ paper: value });
            }}
          >
            <ToggleGroupItem value="a4">A4</ToggleGroupItem>
            <ToggleGroupItem value="letter">Letter</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="flex flex-col gap-2">
          <SwitchRow
            label="Title header"
            checked={settings.header}
            disabled={preparing}
            onChange={(header) => {
              update({ header });
            }}
          />
          <SwitchRow
            label="Page numbers"
            checked={settings.pageNumbers}
            disabled={preparing}
            onChange={(pageNumbers) => {
              update({ pageNumbers });
            }}
          />
        </div>
        {error !== undefined && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={preparing}
            onClick={() => {
              cancel();
            }}
          >
            Cancel
          </Button>
          <Button
            autoFocus
            disabled={preparing || settings.tracks.length === 0}
            onClick={() => {
              void store.getState().print().catch(console.error);
            }}
          >
            {preparing ? 'Preparing…' : 'Print…'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
