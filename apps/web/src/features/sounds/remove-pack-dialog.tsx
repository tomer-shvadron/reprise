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
  /** Tracks of the open song that use the pack. */
  usedBy: number;
  onConfirm: (pack: InstalledPack) => void;
  onCancel: () => void;
}

export function RemovePackDialog({ pack, usedBy, onConfirm, onCancel }: RemovePackDialogProps) {
  return (
    <Dialog
      open={pack !== undefined}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Escape closes this dialog only, not the screen behind it.
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle>Remove &ldquo;{pack?.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            {usedBy > 0
              ? `${String(usedBy)} ${usedBy === 1 ? 'track' : 'tracks'} of the open song use this pack. They play General MIDI instead, and no song is changed. `
              : 'No track of the open song uses this pack. '}
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
