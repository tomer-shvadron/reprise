import { cloneElement, useId, type FocusEvent, type ReactElement, type ReactNode } from 'react';

import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { shortcutParts, type KeyboardPlatform, type Shortcut } from './keyboard';
import { useCommand, type RegisteredCommandId } from './use-command';

interface ShortcutKeysProps {
  bindings: readonly Shortcut[];
  platform: KeyboardPlatform;
}

/**
 * The keys as key caps, one cap per key and "or" between bindings. Hidden from assistive
 * technology: the spoken form in the tooltip's label is what a screen reader reads.
 */
export function ShortcutKeys({ bindings, platform }: ShortcutKeysProps) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-1">
      {bindings.map((shortcut, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 && <span className="opacity-70">or</span>}
          <KbdGroup>
            {shortcutParts(shortcut, platform).map((part, at) => (
              <Kbd key={at}>{part}</Kbd>
            ))}
          </KbdGroup>
        </span>
      ))}
    </span>
  );
}

interface CommandTooltipProps {
  command: RegisteredCommandId;
  label: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  /**
   * What to do when no key is bound: `'label'` keeps a label-only tooltip, for an icon-only
   * control; `'none'` shows none, for a control whose visible text already is the label.
   */
  whenUnbound?: 'label' | 'none';
  /** False for a text field, so the tooltip never covers what is being typed; hover still opens it. */
  openOnFocus?: boolean;
  /**
   * Why the control is disabled: shown instead of the keys, on a wrapper that can take the hover.
   * Passing the prop at all, even as `undefined`, puts the control in that wrapper for good, so a
   * reason that comes and goes never remounts the control or takes its focus.
   */
  reason?: string | undefined;
  /**
   * False while the control's click does something else than the command (a section button runs
   * the loop command only once it is the looped section): a label-only tooltip, with no keys and
   * no `aria-keyshortcuts`, in the same place in the tree so the control keeps its focus.
   */
  active?: boolean;
  /** Extra content after the keys, with its spoken text for the accessible label. */
  detail?: { node: ReactNode; spoken: string };
  children: ReactElement<Record<string, unknown>>;
}

/**
 * A control that runs a registered command, with its keys read from the registry (so a rebind
 * reaches the tooltip and `aria-keyshortcuts` together). Call sites do not set either themselves.
 */
export function CommandTooltip(props: CommandTooltipProps) {
  const wrapped = 'reason' in props;
  const {
    command,
    label,
    side,
    whenUnbound: requested = 'label',
    openOnFocus = true,
    active = true,
    reason,
    detail,
    children,
  } = props;
  const own = useCommand(command);
  const whenUnbound = active ? requested : 'label';
  const bound = active ? own : { ...own, bindings: [], ariaKeys: undefined, spoken: undefined };
  const reasonId = useId();
  if (bound.bindings.length === 0 && whenUnbound === 'none' && reason === undefined && !wrapped) {
    // A bare return changes the tree if a key comes or goes later; only unwrapped controls take it.
    return children;
  }
  const hidden = bound.bindings.length === 0 && whenUnbound === 'none' && reason === undefined;
  const keyed = reason === undefined && bound.bindings.length > 0;
  const spoken =
    reason === undefined
      ? bound.spoken
        ? `${label}, ${bound.spoken}`
        : label
      : `${label}: ${reason}`;
  const accessibleLabel = detail && reason === undefined ? `${spoken}. ${detail.spoken}` : spoken;
  const onFocus = openOnFocus
    ? undefined
    : (event: FocusEvent) => {
        event.preventDefault();
      };

  const trigger =
    reason === undefined && !wrapped ? (
      cloneElement(children, {
        'aria-keyshortcuts': bound.ariaKeys,
        'data-command-tooltip': active ? command : undefined,
      })
    ) : (
      <span className="flex min-w-0" data-command-tooltip={active ? command : undefined}>
        {cloneElement(children, {
          'aria-keyshortcuts': bound.ariaKeys,
          'aria-describedby': reason === undefined ? undefined : reasonId,
        })}
        {reason !== undefined && (
          <span id={reasonId} className="sr-only">
            {reason}
          </span>
        )}
      </span>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild onFocus={onFocus}>
        {trigger}
      </TooltipTrigger>
      {!hidden && (
        <TooltipContent aria-label={accessibleLabel} side={side}>
          {reason === undefined ? label : `${label}: ${reason}`}
          {keyed && <ShortcutKeys bindings={bound.bindings} platform={bound.keyboard} />}
          {detail && reason === undefined && detail.node}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

interface HintTooltipProps {
  label: ReactNode;
  /** The spoken form, when the label holds key caps that assistive technology skips. */
  spoken?: string;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement<Record<string, unknown>>;
}

/** A tooltip for a control that runs no command, so every tooltip in the app comes from this file. */
export function HintTooltip({ label, spoken, side, children }: HintTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent aria-label={spoken} side={side}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
