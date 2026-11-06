import { useEffect, useSyncExternalStore } from 'react';

/** Geist is declared by @fontsource-variable/geist; layout measured it at weight 400. */
const GEIST = '400 16px "Geist Variable"';

let ready =
  typeof FontFace === 'undefined' || typeof document === 'undefined' || !('fonts' in document);
let loading: Promise<void> | undefined;
const listeners = new Set<() => void>();

/**
 * Loads Bravura and Geist once per page and resolves when both settle. Bravura goes through the
 * FontFace API from `BASE_URL`, which is `./` in the Electron build where an absolute
 * `@font-face` URL would miss under `file://`. A failure warns and still resolves: a fallback
 * font beats a blank score.
 */
export function loadScoreFonts(): Promise<void> {
  if (loading) return loading;
  if (ready) {
    loading = Promise.resolve();
    return loading;
  }
  const bravura = new FontFace(
    'Bravura',
    `url(${import.meta.env.BASE_URL}fonts/bravura/Bravura.woff2) format('woff2')`,
    { display: 'block' },
  );
  document.fonts.add(bravura);
  loading = Promise.allSettled([bravura.load(), document.fonts.load(GEIST)]).then((results) => {
    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('A score font failed to load; painting with a fallback.', result.reason);
      }
    }
    ready = true;
    for (const listener of listeners) listener();
  });
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const isReady = () => ready;

/** Whether the score fonts are ready; starts loading them on first use. */
export function useScoreFonts(): boolean {
  const fontsReady = useSyncExternalStore(subscribe, isReady, isReady);
  useEffect(() => {
    void loadScoreFonts();
  }, []);
  return fontsReady;
}
