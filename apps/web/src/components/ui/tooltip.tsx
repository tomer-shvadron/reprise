'use client';

import * as React from 'react';
import { cn } from 'cn';
import { Tooltip as TooltipPrimitive } from 'radix-ui';

import { markTooltipEscape } from './tooltip-escape';

/**
 * Tooltips open after this long, so one does not appear under a click. Only hover waits: Radix opens
 * a tooltip at once on keyboard focus (and on focus returning after a popover or menu closes),
 * which is right for keyboard users. Radix's skip delay (300 ms
 * by default) keeps moving between neighbouring tooltips quick.
 */
export const TOOLTIP_DELAY_MS = 500;

function TooltipProvider({
  delayDuration = TOOLTIP_DELAY_MS,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

/**
 * Radix announces a tooltip opening with a `tooltip.open` event so the others close. Uncontrolled,
 * it sends that from a passive effect after the commit, by which time a tooltip reopened while its
 * content is still animating out has that content mounted and listening: it hears its own
 * announcement and closes again (#438). Controlled, Radix sends it synchronously from the setter,
 * before the commit, and the leaving content's close is then a no-op.
 */
function Tooltip({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [own, setOwn] = React.useState(defaultOpen);
  const controlled = openProp !== undefined;
  return (
    <TooltipPrimitive.Root
      data-slot="tooltip"
      open={controlled ? openProp : own}
      onOpenChange={(next) => {
        if (!controlled) setOwn(next);
        onOpenChange?.(next);
      }}
      {...props}
    />
  );
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        onEscapeKeyDown={(event) => {
          // Radix calls this before it checks defaultPrevented: an earlier listener's Escape is not ours.
          if (!event.defaultPrevented) markTooltipEscape(event);
          onEscapeKeyDown?.(event);
        }}
        className={cn(
          'bg-foreground text-background data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-md px-3 py-1.5 text-xs has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-sm',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="bg-foreground fill-foreground z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
