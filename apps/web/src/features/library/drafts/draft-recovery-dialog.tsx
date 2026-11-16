import { useState } from 'react';
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
import { useAppServices } from '@/app/services-context';

import { libraryOf } from '../library';
import { relativeDate } from '../relative-date';

/**
 * Offered at launch when a draft is newer than its song's last save, as after a crash or a kill.
 * Escape and Later keep the drafts for the next launch; Discard all removes them.
 */
export function DraftRecoveryDialog() {
  const services = useAppServices();
  const { recovery } = libraryOf(services).drafts;
  const { offers, open } = useStore(recovery.store);
  const [now] = useState(Date.now);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) recovery.later();
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Reprise closed with unsaved changes</DialogTitle>
          <DialogDescription>
            These songs have changes that were never saved. Recovering one opens it unsaved, so you
            can save it or discard the changes yourself.
          </DialogDescription>
        </DialogHeader>
        <ul aria-label="Drafts to recover" className="flex flex-col gap-2">
          {offers.map((offer) => (
            <li key={offer.key} className="flex items-center justify-between gap-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{offer.name}</span>
                <span className="text-ink-muted block text-sm">
                  {relativeDate(offer.updatedAt, now)}
                </span>
              </span>
              <span className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  aria-label={`Discard ${offer.name}`}
                  onClick={() => void recovery.discard(offer.key)}
                >
                  Discard
                </Button>
                <Button
                  aria-label={`Recover ${offer.name}`}
                  onClick={() => void recovery.recover(offer.key)}
                >
                  Recover
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              recovery.later();
            }}
          >
            Later
          </Button>
          <Button variant="outline" onClick={() => void recovery.discardAll()}>
            Discard all
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
