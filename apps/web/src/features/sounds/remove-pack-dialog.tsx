import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { InstalledPack } from './manifest';

interface RemovePackDialogProps {
  pack: InstalledPack | undefined;
  /** Tracks of the open song that use the pack; undefined when no song is open. */
  usedBy: number | undefined;
  onConfirm: (pack: InstalledPack) => void;
  onCancel: () => void;
  /** The dialog closed and focus would return to the trigger; the caller places it instead. */
  onClosed: () => void;
}

function usage(usedBy: number | undefined): string {
  if (usedBy === undefined) return 'No song is open, so which tracks use this pack is not shown. ';
  if (usedBy === 0) return 'No track of the open song uses this pack. ';
  return usedBy === 1
    ? '1 track of the open song uses this pack. It plays General MIDI instead, and no song is changed. '
    : `${String(usedBy)} tracks of the open song use this pack. They play General MIDI instead, and no song is changed. `;
}

export function RemovePackDialog({
  pack,
  usedBy,
  onConfirm,
  onCancel,
  onClosed,
}: RemovePackDialogProps) {
  return (
    <Dialog
      open={pack !== undefined}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          // The trigger may be gone by now (a removed pack's row): the screen places focus.
          event.preventDefault();
          onClosed();
        }}
        // Escape closes this dialog only, not the screen behind it.
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle>Remove &ldquo;{pack?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {usage(usedBy)}
            Other songs that use it fall back to General MIDI the same way. Installing the pack
            again brings the sound back.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (pack) onConfirm(pack);
            }}
          >
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
