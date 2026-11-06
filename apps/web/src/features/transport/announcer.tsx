import { useEffect, useState } from 'react';

import { useAppServices } from '@/app/services-context';

/** The bar's one live region; it speaks only when asked, never for the moving position. */
export function Announcer() {
  const { transport } = useAppServices();
  const [text, setText] = useState('');

  // Cleared first and set a frame later, so a screen reader reads a repeated sentence again.
  useEffect(() => {
    let frame: number | undefined;
    const unsubscribe = transport.subscribe(({ announcement }, previous) => {
      if (announcement === previous.announcement) return;
      if (frame !== undefined) cancelAnimationFrame(frame);
      setText('');
      frame = requestAnimationFrame(() => {
        setText(announcement?.text ?? '');
      });
    });
    return () => {
      unsubscribe();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [transport]);

  return (
    <div role="status" aria-live="polite" className="sr-only" data-announcer>
      {text}
    </div>
  );
}
