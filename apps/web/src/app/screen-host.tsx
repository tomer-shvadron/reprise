import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface ScreenHostProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A full-window screen over the player. The player beneath is made inert by the caller; this
 * takes focus on open, gives it back on close and closes on Escape.
 */
export function ScreenHost({ label, onClose, children }: ScreenHostProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const before = document.activeElement;
    ref.current?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label={label}
      className="bg-background fixed inset-0 z-40 flex flex-col outline-none"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center border-b p-2">
        <Button variant="ghost" size="sm" onClick={onClose}>
          Back to player
        </Button>
      </div>
      {children}
    </section>
  );
}
