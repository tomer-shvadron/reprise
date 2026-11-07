import { createPortal } from 'react-dom';
import { useStore } from 'zustand';

import { PrintDocument } from './print-document';
import type { PrintStore } from './print-store';

/** The print job's pages, as a sibling of the app in `body`, only while a job exists. */
export function PrintRoot({ store }: { store: PrintStore }) {
  const job = useStore(store, (state) => state.job);
  if (!job) return null;
  return createPortal(
    <PrintDocument
      content={job}
      onReady={() => {
        store.getState().rendered(job.id);
      }}
    />,
    document.body,
  );
}
