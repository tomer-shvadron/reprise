/**
 * An open tooltip takes an Escape like any Radix layer (it calls `preventDefault`), which would
 * also stop the shortcut dispatcher. The tooltip marks the event here so the dispatcher can tell
 * "only a tooltip took this" from "a popover, menu or dialog did" (#398).
 */
const tooltipEscapes = new WeakSet<Event>();

export function markTooltipEscape(event: Event): void {
  tooltipEscapes.add(event);
}

/**
 * A handler that consumes an Escape for itself (the selection pill's focus return) claims it, so a
 * tooltip open at the same moment does not make it count as "only a tooltip took this".
 */
export function claimEscape(event: Event): void {
  tooltipEscapes.delete(event);
}

export function isTooltipEscape(event: Event): boolean {
  return tooltipEscapes.has(event);
}

/**
 * Whether a popover or menu is open. Radix lets only the topmost layer take an Escape, so a
 * tooltip opened over one would hide it from the key; the popover must still get its close.
 */
export function otherLayerOpen(): boolean {
  return [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].some(
    (wrapper) =>
      wrapper.querySelector('[data-slot="tooltip-content"]') === null &&
      wrapper.querySelector('[data-state="open"]') !== null,
  );
}
