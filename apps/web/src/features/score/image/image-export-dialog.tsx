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
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import type { ImageExporter, ImageScopeKind } from './image-exporter';
import { parsePage } from './image-exporter';
import type { ImageFormat, ImageScale } from './image-export';
import type { ImageBackground } from './svg-page';
import type { PaperSize } from '../view-options';

function OptionRow({
  label,
  children,
  hint,
}: {
  label: string;
  children: (labelId: string) => React.ReactNode;
  hint?: string | undefined;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-4">
        <p id={id} className="text-sm font-medium">
          {label}
        </p>
        {children(id)}
      </div>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

const isFormat = (value: string): value is ImageFormat => value === 'svg' || value === 'png';
const isBackground = (value: string): value is ImageBackground =>
  value === 'white' || value === 'transparent';
const isPaper = (value: string): value is PaperSize => value === 'a4' || value === 'letter';
const toScale = (value: string): ImageScale | undefined =>
  value === '1' ? 1 : value === '2' ? 2 : value === '3' ? 3 : undefined;

/** Export as image: the scope, the format, the scale, the background and the paper. A modal. */
export function ImageExportDialog({ exporter }: { exporter: ImageExporter }) {
  const dialog = useStore(exporter.store, (state) => state.dialog);
  const scopeLabel = useId();
  const pageId = useId();
  if (!dialog) return null;
  const { selectedBars, progress } = dialog;
  const busy = progress !== undefined;
  const page = parsePage(dialog.pageText);
  const canExport = !busy && (dialog.scope !== 'page' || page !== undefined);
  const scopeOption = (value: ImageScopeKind, label: string, extra?: React.ReactNode) => (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        name="image-scope"
        checked={dialog.scope === value}
        disabled={busy}
        onChange={() => {
          exporter.update({ scope: value });
        }}
      />
      {label}
      {extra}
    </label>
  );
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) exporter.cancel();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Export as image</DialogTitle>
          <DialogDescription>
            Writes the score as SVG or PNG in print colours. Several pages go into one zip.
          </DialogDescription>
        </DialogHeader>
        <div role="radiogroup" aria-labelledby={scopeLabel} className="flex flex-col gap-2">
          <p id={scopeLabel} className="text-sm font-medium">
            Scope
          </p>
          {scopeOption('score', 'Whole score')}
          {scopeOption(
            'page',
            'Page',
            <Input
              id={pageId}
              type="number"
              inputMode="numeric"
              min={1}
              aria-label="Page number"
              aria-invalid={page === undefined}
              value={dialog.pageText}
              disabled={busy || dialog.scope !== 'page'}
              className="w-20"
              onChange={(event) => {
                exporter.update({ pageText: event.target.value });
              }}
            />,
          )}
          {selectedBars &&
            scopeOption(
              'bars',
              selectedBars.first === selectedBars.last
                ? `Selected bar ${String(selectedBars.first)}`
                : `Selected bars ${String(selectedBars.first)}–${String(selectedBars.last)}`,
            )}
        </div>
        <OptionRow label="Format">
          {(labelledBy) => (
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={labelledBy}
              value={dialog.format}
              disabled={busy}
              onValueChange={(value) => {
                if (isFormat(value)) exporter.update({ format: value });
              }}
            >
              <ToggleGroupItem value="svg">SVG</ToggleGroupItem>
              <ToggleGroupItem value="png">PNG</ToggleGroupItem>
            </ToggleGroup>
          )}
        </OptionRow>
        {dialog.format === 'png' && (
          <OptionRow label="Scale">
            {(labelledBy) => (
              <ToggleGroup
                type="single"
                variant="outline"
                aria-labelledby={labelledBy}
                value={String(dialog.scale)}
                disabled={busy}
                onValueChange={(value) => {
                  const scale = toScale(value);
                  if (scale) exporter.update({ scale });
                }}
              >
                <ToggleGroupItem value="1">1×</ToggleGroupItem>
                <ToggleGroupItem value="2">2×</ToggleGroupItem>
                <ToggleGroupItem value="3">3×</ToggleGroupItem>
              </ToggleGroup>
            )}
          </OptionRow>
        )}
        <OptionRow label="Background">
          {(labelledBy) => (
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={labelledBy}
              value={dialog.background}
              disabled={busy}
              onValueChange={(value) => {
                if (isBackground(value)) exporter.update({ background: value });
              }}
            >
              <ToggleGroupItem value="white">White</ToggleGroupItem>
              <ToggleGroupItem value="transparent">Transparent</ToggleGroupItem>
            </ToggleGroup>
          )}
        </OptionRow>
        <OptionRow label="Paper" hint="Exported in print colours.">
          {(labelledBy) => (
            <ToggleGroup
              type="single"
              variant="outline"
              aria-labelledby={labelledBy}
              value={dialog.paper}
              disabled={busy}
              onValueChange={(value) => {
                if (isPaper(value)) exporter.update({ paper: value });
              }}
            >
              <ToggleGroupItem value="a4">A4</ToggleGroupItem>
              <ToggleGroupItem value="letter">Letter</ToggleGroupItem>
            </ToggleGroup>
          )}
        </OptionRow>
        {busy && (
          <p role="status" className="text-muted-foreground text-sm">
            {progress.total > 1
              ? `Exporting page ${String(Math.min(progress.done + 1, progress.total))} of ${String(progress.total)}…`
              : 'Exporting…'}
          </p>
        )}
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
