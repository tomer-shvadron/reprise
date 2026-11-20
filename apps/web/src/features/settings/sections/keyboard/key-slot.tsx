import { RotateCcw, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import {
  formatShortcut,
  spokenShortcut,
  type KeyboardPlatform,
  type Shortcut,
} from '@/app/keyboard';
import type { KeyBinding } from '@/app/keymap';
import {
  heldModifiers,
  readKeyEvent,
  type KeyEventInfo,
  type RefuseReason,
} from '@/app/record-key';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import type { Slot } from './rows';

export const REFUSALS: Readonly<Record<RefuseReason, string>> = {
  native: 'That key belongs to copy, cut or paste and cannot be a shortcut.',
  'select-all': 'That key selects all text in a field and cannot be a shortcut.',
  reserved: 'The system keeps that key and cannot give it to a command.',
  control: 'Control combinations are not supported on macOS.',
  'windows-key': 'Windows key combinations are not supported.',
  'option-symbol': 'That Option key types a symbol. Pick another key.',
  unsupported: 'That key cannot be a shortcut.',
};

const iconButton =
  'text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-6 items-center justify-center rounded-sm outline-none focus-visible:ring-2';

interface RecorderProps {
  title: string;
  keyboard: KeyboardPlatform;
  natives: readonly Shortcut[];
  onKey: (binding: KeyBinding) => void;
  onCancel: () => void;
  onBlur: () => void;
  onRefuse: (reason: RefuseReason) => void;
}

/**
 * Takes the next keystroke. A `role="application"` box, so a screen reader in browse mode passes
 * every key through instead of using it for navigation; not a button (Space and Enter would
 * activate it) and not an input (it would claim to be editable). Tab is never taken: it leaves,
 * and leaving cancels, so focus is never trapped.
 */
function Recorder({ title, keyboard, natives, onKey, onCancel, onBlur, onRefuse }: RecorderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const help = useId();
  const [held, setHeld] = useState('');
  useEffect(() => {
    ref.current?.focus();
  }, []);

  const handle = (event: KeyboardEvent<HTMLDivElement>) => {
    const native: KeyEventInfo = event.nativeEvent;
    const read = readKeyEvent(native, keyboard, natives);
    if (read.kind === 'leave') return;
    event.preventDefault();
    event.stopPropagation();
    if (read.kind === 'wait') setHeld(heldModifiers(native, keyboard));
    else if (read.kind === 'cancel') onCancel();
    else if (read.kind === 'refuse') onRefuse(read.reason);
    else onKey(read.binding);
  };

  return (
    <>
      <div
        ref={ref}
        role="application"
        tabIndex={0}
        data-escape-local=""
        aria-label={`Press the new key for ${title}`}
        aria-describedby={help}
        onKeyDown={handle}
        onKeyUp={(event) => {
          setHeld(heldModifiers(event.nativeEvent, keyboard));
        }}
        onBlur={onBlur}
        className="border-ring bg-muted/50 focus-visible:ring-ring min-w-24 rounded-md border px-2 py-0.5 text-center text-xs outline-none focus-visible:ring-2"
      >
        {held ? `${held}…` : 'Press a key…'}
      </div>
      <span id={help} className="text-muted-foreground text-xs">
        Escape cancels. Tab leaves.
      </span>
    </>
  );
}

export interface KeySlotProps {
  slot: Slot;
  /** Set when the row has several slots, to tell their buttons apart. */
  position?: string | undefined;
  keyboard: KeyboardPlatform;
  recording: boolean;
  natives: readonly Shortcut[];
  buttonRef: (element: HTMLButtonElement | null) => void;
  onRecord: () => void;
  onKey: (binding: KeyBinding) => void;
  onCancel: () => void;
  onBlur: () => void;
  onRefuse: (reason: RefuseReason) => void;
  onClear: () => void;
  onReset: () => void;
}

/** One key of a command: the key button that starts recording, clear and reset. */
export function KeySlot(props: KeySlotProps) {
  const { position, keyboard, recording, natives, buttonRef, slot } = props;
  const { onRecord, onKey, onCancel, onBlur, onRefuse, onClear, onReset } = props;
  const { command, shortcut, fallback, changed, displacedBy, fixed } = slot;
  const spoken = (key: Shortcut) => spokenShortcut(key, keyboard);
  const suffix = position ? ` (${position})` : '';

  if (fixed !== undefined) {
    return (
      <span className="flex items-center gap-2">
        {shortcut ? (
          <kbd
            aria-label={`${spoken(shortcut)}, ${fixed.toLowerCase()}`}
            title={fixed}
            className="text-muted-foreground font-mono text-xs"
          >
            {formatShortcut(shortcut, keyboard)}
          </kbd>
        ) : null}
      </span>
    );
  }
  if (recording) {
    return (
      <span className="flex items-center gap-2">
        <Recorder
          title={command.title}
          keyboard={keyboard}
          natives={natives}
          onKey={onKey}
          onCancel={onCancel}
          onBlur={onBlur}
          onRefuse={onRefuse}
        />
      </span>
    );
  }

  const resetLabel = fallback
    ? `Reset ${command.title}${suffix} to ${spoken(fallback)}`
    : `Reset ${command.title}${suffix} to no key`;
  return (
    <span className="flex items-center gap-1">
      {changed && <span aria-hidden className="bg-primary size-1.5 rounded-full" title="Changed" />}
      {changed && <span className="sr-only">changed</span>}
      <button
        ref={buttonRef}
        type="button"
        onClick={onRecord}
        aria-label={
          shortcut
            ? `Change key for ${command.title}${suffix}, now ${spoken(shortcut)}`
            : `Add key for ${command.title}${suffix}`
        }
        className="hover:bg-muted focus-visible:ring-ring min-w-12 rounded-md border px-2 py-0.5 text-xs outline-none focus-visible:ring-2"
      >
        {shortcut ? (
          <kbd className="font-mono">{formatShortcut(shortcut, keyboard)}</kbd>
        ) : (
          <span className="text-muted-foreground">Add key</span>
        )}
      </button>
      {displacedBy && (
        <span className="text-muted-foreground text-xs">
          {fallback
            ? `(${formatShortcut(fallback, keyboard)} now runs ${displacedBy.title})`
            : null}
        </span>
      )}
      {shortcut && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={iconButton}
              aria-label={`Remove ${spoken(shortcut)} from ${command.title}${suffix}`}
              onClick={onClear}
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Remove key</TooltipContent>
        </Tooltip>
      )}
      {(changed || displacedBy) && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className={iconButton} aria-label={resetLabel} onClick={onReset}>
              <RotateCcw aria-hidden className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

interface PromptProps {
  sentence: string;
  onSwap: () => void;
  onCancel: () => void;
}

/** The swap offer for a key another command holds; focus lands on Swap, Escape cancels. */
export function ConflictPrompt({ sentence, onSwap, onCancel }: PromptProps) {
  const label = useId();
  const swap = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    swap.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-labelledby={label}
      data-escape-local=""
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }}
      className="bg-muted/50 mt-1 flex flex-wrap items-center gap-2 rounded-md px-2 py-1 text-xs"
    >
      <span id={label}>{sentence}</span>
      <button
        ref={swap}
        type="button"
        onClick={onSwap}
        className="bg-primary text-primary-foreground focus-visible:ring-ring rounded-md px-2 py-0.5 outline-none focus-visible:ring-2"
      >
        Swap
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="hover:bg-muted focus-visible:ring-ring rounded-md border px-2 py-0.5 outline-none focus-visible:ring-2"
      >
        Cancel
      </button>
    </div>
  );
}
