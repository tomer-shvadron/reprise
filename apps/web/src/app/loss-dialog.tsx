import type { Warning } from '@reprise/formats';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import { WarningList } from './notices';

export interface LossChoice<T extends string> {
  value: T;
  label: string;
  /** Focused when the dialog opens; the safe choice. */
  primary?: boolean;
}

/** Asks before something is written that cannot hold everything; Escape picks `cancel`. */
export function LossDialog<T extends string>({
  open,
  title,
  description,
  losses,
  choices,
  cancel,
  cancelLabel = 'Cancel',
  busy = false,
  onCloseAutoFocus,
  onChoose,
}: {
  open: boolean;
  title: string;
  description: string;
  losses: readonly Warning[];
  choices: readonly LossChoice<T>[];
  cancel: T;
  /** The cancel button's text, e.g. "OK" for a notice. */
  cancelLabel?: string;
  /** Disables every button and Escape, while what a choice started is still running. */
  busy?: boolean;
  /** Where focus goes when the dialog closes; the default is back to what had it. */
  onCloseAutoFocus?: (event: Event) => void;
  onChoose: (value: T) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onChoose(cancel);
      }}
    >
      <DialogContent showCloseButton={false} {...(onCloseAutoFocus && { onCloseAutoFocus })}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {losses.length > 0 && <WarningList warnings={losses} label="What will be lost" />}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              onChoose(cancel);
            }}
          >
            {cancelLabel}
          </Button>
          {choices.map((choice) => (
            <Button
              key={choice.value}
              variant={choice.primary === true ? 'default' : 'outline'}
              autoFocus={choice.primary}
              disabled={busy}
              onClick={() => {
                onChoose(choice.value);
              }}
            >
              {choice.label}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
