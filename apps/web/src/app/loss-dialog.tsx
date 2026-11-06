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
  onChoose,
}: {
  open: boolean;
  title: string;
  description: string;
  losses: readonly Warning[];
  choices: readonly LossChoice<T>[];
  cancel: T;
  onChoose: (value: T) => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onChoose(cancel);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {losses.length > 0 && <WarningList warnings={losses} label="What will be lost" />}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onChoose(cancel);
            }}
          >
            Cancel
          </Button>
          {choices.map((choice) => (
            <Button
              key={choice.value}
              variant={choice.primary === true ? 'default' : 'outline'}
              autoFocus={choice.primary}
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
