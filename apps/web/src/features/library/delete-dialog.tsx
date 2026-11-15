import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { SongRow } from './db/rows';

interface DeleteDialogProps {
  song: SongRow | undefined;
  onConfirm: (song: SongRow) => void;
  onCancel: () => void;
}

export function DeleteDialog({ song, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <Dialog
      open={song !== undefined}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        // Escape closes this dialog only, not the library screen behind it.
        onKeyDown={(event) => {
          event.stopPropagation();
        }}
      >
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{song?.title}&rdquo;?</DialogTitle>
          <DialogDescription>
            The song leaves your library. Its files move to the library&rsquo;s trash folder, so you
            can still restore them by hand.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (song) onConfirm(song);
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
