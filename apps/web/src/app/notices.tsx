import type { Warning, WarningSeverity } from '@reprise/formats';
import { useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import { Button } from '@/components/ui/button';

import { useAppServices } from './services-context';

const MAX_ROWS = 200;
const SEVERITY_ORDER: Record<WarningSeverity, number> = { error: 0, warning: 1, info: 2 };

function Notice({
  kind,
  title,
  children,
  onDismiss,
  actions,
}: {
  kind: 'error' | 'warning';
  title: string;
  children?: ReactNode;
  onDismiss: () => void;
  actions?: ReactNode;
}) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className="bg-popover text-popover-foreground pointer-events-auto w-96 max-w-full rounded-lg border p-3 text-sm shadow-lg"
    >
      <p className="font-medium">{title}</p>
      {children}
      <div className="mt-2 flex justify-end gap-2">
        {actions}
        <Button variant="ghost" size="xs" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function locationOf(warning: Warning): string {
  const { track, bar, beat } = warning.location;
  return [
    track !== undefined && `Track ${String(track + 1)}`,
    bar !== undefined && `bar ${String(bar + 1)}`,
    beat !== undefined && `beat ${String(beat + 1)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function WarningList({
  warnings,
  label = 'Import details',
}: {
  warnings: readonly Warning[];
  label?: string;
}) {
  const sorted = [...warnings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
  const rows = sorted.slice(0, MAX_ROWS);
  return (
    <ul aria-label={label} className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
      {rows.map((warning, index) => {
        const where = locationOf(warning);
        return (
          <li key={index}>
            <span className="text-muted-foreground uppercase">{warning.severity}</span>{' '}
            {warning.message}
            {warning.count !== undefined && warning.count > 1 && ` ×${String(warning.count)}`}
            {where && <span className="text-muted-foreground"> · {where}</span>}
          </li>
        );
      })}
      {sorted.length > rows.length && (
        <li className="text-muted-foreground">and {String(sorted.length - rows.length)} more</li>
      )}
    </ul>
  );
}

function WarningsNotice() {
  const { document } = useAppServices();
  const { open, details, warnings, fileName } = useStore(
    document,
    useShallow((state) => ({
      open: state.warningsOpen,
      details: state.detailsOpen,
      warnings: state.warnings,
      fileName: state.file?.name,
    })),
  );
  if (!open || fileName === undefined) return null;
  const count = warnings.filter((warning) => warning.severity !== 'info').length;
  const title =
    count > 0
      ? `Opened ${fileName} with ${String(count)} ${count === 1 ? 'warning' : 'warnings'}`
      : `Opened ${fileName}`;
  return (
    <Notice
      kind="warning"
      title={title}
      onDismiss={() => {
        document.getState().setWarningsOpen(false);
      }}
      actions={
        warnings.length > 0 && (
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={details}
            onClick={() => {
              document.getState().setDetailsOpen(!details);
            }}
          >
            Details
          </Button>
        )
      }
    >
      {warnings.length === 0 && <p className="text-muted-foreground mt-1">No import details.</p>}
      {details && <WarningList warnings={warnings} />}
    </Notice>
  );
}

function DocumentErrorNotice() {
  const { document } = useAppServices();
  const error = useStore(document, (state) => state.error);
  if (!error) return null;
  const verb = error.action === 'open' ? 'open' : 'save';
  return (
    <Notice
      kind="error"
      title={`Could not ${verb} ${error.fileName}`}
      onDismiss={() => {
        document.getState().dismissError();
      }}
    >
      <p className="text-muted-foreground mt-1">
        {error.message}
        {error.code !== undefined && ` (${error.code})`}
      </p>
    </Notice>
  );
}

function SoundsNotice() {
  const { playback, audio } = useAppServices();
  const message = useStore(
    playback,
    (state) => state.output.error ?? state.sounds.error ?? state.song.error,
  );
  const [dismissed, setDismissed] = useState<string | undefined>(undefined);
  if (message === undefined || message === dismissed) return null;
  return (
    <Notice
      kind="error"
      title="Sounds unavailable"
      onDismiss={() => {
        setDismissed(message);
      }}
      actions={
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            audio.retry();
          }}
        >
          Retry
        </Button>
      }
    >
      <p className="text-muted-foreground mt-1">{message}</p>
    </Notice>
  );
}

export function Notices() {
  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 bottom-18 z-40 flex flex-col items-end gap-2"
    >
      <DocumentErrorNotice />
      <WarningsNotice />
      <SoundsNotice />
    </section>
  );
}
