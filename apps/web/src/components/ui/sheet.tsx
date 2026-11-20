'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTitle({ ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return <SheetPrimitive.Title data-slot="sheet-title" {...props} />;
}

/**
 * A modal sheet anchored to the bottom edge, for views that sit over the player rather than
 * replace it. The overlay is not blurred: a blur over a score that is playing would recomposite
 * every frame. The close button comes last in the DOM, so it is the last tab stop.
 */
function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 fixed inset-0 isolate z-50 bg-black/40 backdrop-blur-none duration-150 motion-reduce:animate-none"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-background text-foreground ring-foreground/10 data-open:animate-in data-open:slide-in-from-bottom-8 data-open:fade-in-0 data-closed:animate-out data-closed:slide-out-to-bottom-8 data-closed:fade-out-0 fixed inset-x-0 bottom-0 z-50 mx-auto flex flex-col overflow-hidden rounded-t-xl text-sm shadow-2xl ring-1 duration-150 outline-none motion-reduce:animate-none',
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close data-slot="sheet-close" asChild>
          <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
            <XIcon />
            <span className="sr-only">Close</span>
          </Button>
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetContent, SheetTitle };
