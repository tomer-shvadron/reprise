import { useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import type { SheetId } from '@/state/ui';

import { useMenuFocusReturn } from './menu-focus-return';
import { useAppServices } from './services-context';

/**
 * Wide for the library's six-column table, medium for the sound manager. The top is never above
 * the header band and the height never beyond 60rem, so a tall window shows more of the player.
 */
const WIDTH = {
  wide: 'w-[min(calc(100vw-2rem),72rem)]',
  medium: 'w-[min(calc(100vw-2rem),56rem)]',
} as const;

interface AppSheetProps {
  id: SheetId;
  title: string;
  width: keyof typeof WIDTH;
  children: ReactNode;
}

/**
 * The library or the sound manager as a modal sheet over the player, which stays mounted, dimmed
 * and hidden from assistive technology behind it. Each sheet has its own Radix root: a single one
 * would paint the wrong content while it animates closed.
 *
 * `children` must not sit in a scroller: the song list is windowed and needs a parent of definite
 * height.
 */
export function AppSheet({ id, title, width, children }: AppSheetProps) {
  const { ui } = useAppServices();
  const open = useStore(ui, (state) => state.sheet === id);
  const focusReturn = useMenuFocusReturn();
  // Set when the user dismissed the sheet (Escape, the X or an outside click all arrive through
  // `onOpenChange`); a close the store made (a song opened, a resume, a new song) leaves it unset.
  const dismissed = useRef(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          dismissed.current = true;
          ui.getState().closeSheet();
        }
      }}
    >
      <SheetContent
        data-app-sheet={id}
        // The title is a span, not Radix's heading: the content has a visible h1 of the same text.
        aria-describedby={undefined}
        className={`top-[max(2.5rem,calc(100dvh-60rem))] ${WIDTH[width]}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dismissed.current = false;
          focusReturn.remember();
          const content = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
          const first = content?.querySelector<HTMLElement>('[data-sheet-initial-focus]');
          (first ?? content)?.focus();
        }}
        onCloseAutoFocus={(event) => {
          // Radix has no trigger to return to. Focus goes back to where it was only when the user
          // dismissed the sheet: after a song opened from it, the next Space must play that song,
          // not activate the crumb that opened the Library.
          if (dismissed.current) focusReturn.onCloseAutoFocus(event);
          else event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          // Radix listens for Escape in the capture phase, before a React handler can stop it;
          // a local Escape (the practice page, a rename) closes only itself.
          if (
            event.target instanceof Element &&
            event.target.closest('[data-sheet-escape-local]')
          ) {
            event.preventDefault();
          }
        }}
      >
        <SheetTitle asChild>
          <span className="sr-only">{title}</span>
        </SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
