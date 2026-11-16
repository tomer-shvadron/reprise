import { useStore } from 'zustand';

import { LossDialog } from '@/app/loss-dialog';
import { useAppServices } from '@/app/services-context';

import { dialogsOf } from './dialogs';
import { removeTrackNow } from './track-edit';
import { TrackDialog } from './track-dialog';
import { UnsavedChangesDialog } from './unsaved-dialog';

/** Mounts whichever editor dialog is open; one instance in the app, next to the save prompt. */
export function EditorDialogs() {
  const services = useAppServices();
  const store = dialogsOf(services);
  const dialog = useStore(store, (state) => state.dialog);
  const track = useStore(services.document, (state) =>
    dialog?.kind === 'removeTrack'
      ? state.score?.tracks.find(({ id }) => id === dialog.trackId)
      : undefined,
  );
  const close = () => {
    store.getState().close();
  };
  // Back to the "+" or "⋯" that opened the dialog; Radix would otherwise land on the menu item it
  // is unmounting, and so on <body>. Without a trigger (a shortcut, the palette) the default holds.
  const onCloseAutoFocus = (event: Event) => {
    const target = store.getState().returnFocus;
    if (target?.isConnected === true) {
      event.preventDefault();
      target.focus();
    }
  };
  const removeIndex = useStore(services.document, (state) =>
    dialog?.kind === 'removeTrack'
      ? (state.score?.tracks.findIndex(({ id }) => id === dialog.trackId) ?? -1)
      : -1,
  );

  switch (dialog?.kind) {
    case 'track':
      return (
        <TrackDialog
          key={dialog.mode === 'edit' ? dialog.trackId : 'add'}
          target={dialog.mode === 'edit' ? dialog.trackId : undefined}
          onClose={close}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      );
    case 'removeTrack':
      if (!track) return null;
      return (
        <LossDialog<'remove' | 'cancel'>
          open
          title={`Remove “${track.name || `Track ${String(removeIndex + 1)}`}”?`}
          description="Its notes go with it. Undo brings it back."
          losses={[]}
          choices={[{ value: 'remove', label: 'Remove' }]}
          cancel="cancel"
          onCloseAutoFocus={onCloseAutoFocus}
          onChoose={(answer) => {
            close();
            if (answer === 'remove') removeTrackNow(services, track.id);
          }}
        />
      );
    case 'unsaved':
      return (
        <UnsavedChangesDialog
          action={dialog.action}
          onContinue={() => {
            close();
            dialog.onContinue();
          }}
          onCancel={close}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      );
    case 'notice':
      return (
        <LossDialog<'ok'>
          open
          title="Track"
          description={dialog.message}
          losses={[]}
          choices={[]}
          cancel="ok"
          cancelLabel="OK"
          onChoose={close}
          onCloseAutoFocus={onCloseAutoFocus}
        />
      );
    default:
      return null;
  }
}
