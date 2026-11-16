import { useRef, useState } from 'react';
import { useStore } from 'zustand';

import { LossDialog } from './loss-dialog';
import { useAppServices } from './services-context';
import { unsavedOf } from './when-saved';

type Answer = 'save' | 'discard' | 'cancel';

/**
 * Asks Save, Don't save or Cancel before something replaces the open document; start it with
 * `whenSaved`. `action` completes "Save changes to “name” before …?", `onContinue` runs when the
 * way is clear and `onCancel` when it is not, each at most once. Save continues only when the
 * document is not modified afterwards, so a cancelled Save As or a failed write stops everything
 * where it stood. While the save runs every button and Escape are off, so no answer can race it.
 */
export function UnsavedChangesDialog({
  action,
  onContinue,
  onCancel,
  onCloseAutoFocus,
}: {
  action: string;
  onContinue: () => void;
  onCancel: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const { document } = useAppServices();
  const name = useStore(document, (state) => state.file?.name) ?? 'Untitled';
  const [saving, setSaving] = useState(false);
  const settled = useRef(false);

  const finish = (proceed: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (proceed) onContinue();
    else onCancel();
  };

  const choose = (answer: Answer) => {
    if (saving || settled.current) return;
    if (answer === 'cancel') finish(false);
    else if (answer === 'discard') finish(true);
    else {
      setSaving(true);
      void document
        .getState()
        .save()
        .then(
          () => {
            finish(!document.getState().dirty);
          },
          () => {
            finish(false);
          },
        );
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
      busy={saving}
      onChoose={choose}
      {...(onCloseAutoFocus && { onCloseAutoFocus })}
    />
  );
}

/** Mounts the dialog `whenSaved` asks through; one instance in the app. */
export function UnsavedChangesHost() {
  const services = useAppServices();
  const store = unsavedOf(services);
  const request = useStore(store, (state) => state.request);
  if (!request) return null;
  const close = () => {
    store.getState().close();
  };
  return (
    <UnsavedChangesDialog
      action={request.action}
      onContinue={() => {
        close();
        request.onContinue();
      }}
      onCancel={close}
    />
  );
}
