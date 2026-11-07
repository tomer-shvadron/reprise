import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import { PrintDocument } from './print-document';
import type { PrintStore } from './print-store';

/** The print job's pages, as a sibling of the app in `body`, only while a job exists. */
export function PrintRoot({ store }: { store: PrintStore }) {
  // Selects the id, not the job: React keeps the last render's hook state in the alternate
  // fiber, which would hold the job and its layout after the print until the next one.
  const id = useStore(store, (state) => state.job?.id);
  const job = store.getState().job;
  if (id === undefined || job?.id !== id) return null;
  return createPortal(
    <PrintDocument
      content={job}
      onReady={() => {
        store.getState().rendered(id);
      }}
    />,
    document.body,
  );
}
