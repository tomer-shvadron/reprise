import { useStore } from 'zustand';

import { LossDialog } from '@/app/loss-dialog';
import { useAppServices } from '@/app/services-context';

type Answer = 'save' | 'discard' | 'cancel';

/**
 * Asks Save, Don't save or Cancel before something replaces the open document. Reusable by Open
 * and Close (WP-061): `action` completes "Save changes to “name” before …?", `onContinue` runs when
 * the way is clear and `onCancel` when it is not. Save continues only when the document is clean
 * afterwards, so a cancelled Save As or a failed write stops everything where it stood.
 */
export function UnsavedChangesDialog({
  action,
  onContinue,
  onCancel,
}: {
  action: string;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const { document } = useAppServices();
  const name = useStore(document, (state) => state.file?.name) ?? 'Untitled';

  const choose = (answer: Answer) => {
    if (answer === 'cancel') {
      onCancel();
    } else if (answer === 'discard') {
      onContinue();
    } else {
      void document
        .getState()
        .save()
        .then(() => {
          const { dirty, error } = document.getState();
          if (dirty || error !== undefined) onCancel();
          else onContinue();
        });
    }
  };

  return (
    <LossDialog<Answer>
      open
      title="Unsaved changes"
      description={`Save changes to “${name}” before ${action}?`}
      losses={[]}
      choices={[
        { value: 'discard', label: 'Don’t save' },
        { value: 'save', label: 'Save', primary: true },
      ]}
      cancel="cancel"
      onChoose={choose}
    />
  );
}
