import { cloneElement, use, type FocusEvent, type ReactElement, type ReactNode } from 'react';

import { Kbd, KbdGroup } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { shortcutParts, type KeyboardPlatform, type Shortcut } from './keyboard';
import { CommandSourceContext, useCommand, type RegisteredCommandId } from './use-command';

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
  /** Why the control is disabled: shown instead of the keys, on a wrapper that can take the hover. */
  reason?: string;
  children: ReactElement<Record<string, unknown>>;
}

/**
 * A control that runs a registered command, with its keys read from the registry (so a rebind
 * reaches the tooltip and `aria-keyshortcuts` together). Call sites do not set either themselves.
 */
export function CommandTooltip({
  command,
  label,
  side,
  whenUnbound = 'label',
  openOnFocus = true,
  reason,
  children,
}: CommandTooltipProps) {
  const bound = useCommand(command);
  const source = use(CommandSourceContext);
  const platform = source?.keyboard ?? 'other';
  if (bound.bindings.length === 0 && whenUnbound === 'none' && reason === undefined) {
    return children;
  }
  const keyed = reason === undefined && bound.bindings.length > 0;
  const accessibleLabel =
    reason === undefined
      ? bound.spoken
        ? `${label}, ${bound.spoken}`
        : label
      : `${label}: ${reason}`;
  const onFocus = openOnFocus
    ? undefined
    : (event: FocusEvent) => {
        event.preventDefault();
      };
  const reasonId = reason === undefined ? undefined : `${command}-reason`;

  const trigger =
    reason === undefined ? (
      cloneElement(children, {
        'aria-keyshortcuts': bound.ariaKeys,
        'data-command-tooltip': command,
      })
    ) : (
      <span className="flex" data-command-tooltip={command}>
        {cloneElement(children, {
          'aria-keyshortcuts': bound.ariaKeys,
          'aria-describedby': reasonId,
        })}
        <span id={reasonId} className="sr-only">
          {reason}
        </span>
      </span>
    );

  return (
    <Tooltip>
      <TooltipTrigger asChild onFocus={onFocus}>
        {trigger}
      </TooltipTrigger>
      <TooltipContent aria-label={accessibleLabel} side={side}>
        {reason === undefined ? label : `${label}: ${reason}`}
        {keyed && <ShortcutKeys bindings={bound.bindings} platform={platform} />}
      </TooltipContent>
    </Tooltip>
  );
}

interface HintTooltipProps {
  label: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement<Record<string, unknown>>;
}

/** A tooltip for a control that runs no command, so every tooltip in the app comes from this file. */
export function HintTooltip({ label, side, children }: HintTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
