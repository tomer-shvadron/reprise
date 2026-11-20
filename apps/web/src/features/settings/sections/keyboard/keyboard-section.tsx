import { use, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { useAppServices } from '@/app/services-context';
import type { Command } from '@/app/command-registry';
import {
  formatShortcut,
  shortcutOn,
  spokenShortcut,
  type KeyboardPlatform,
  type Shortcut,
} from '@/app/keyboard';
import {
  planChange,
  stamp,
  SHORTCUT_OVERRIDES_SETTING,
  type KeyBinding,
  type KeyPlan,
} from '@/app/keymap';
import type { RefuseReason } from '@/app/record-key';
import { CommandSourceContext } from '@/app/use-command';
import { useSetting } from '@/app/use-setting';
import { Input } from '@/components/ui/input';

import type { SettingsSection } from '../../section';
import { ConflictPrompt, KeySlot, REFUSALS } from './key-slot';
import { buildRows, filterRows, type Row } from './rows';

type Change = KeyBinding | null | 'default';

interface Pending {
  command: Command;
  plan: Extract<KeyPlan, { kind: 'conflict' }>;
  binding: Shortcut | undefined;
}

const spokenOf = (shortcut: Shortcut | undefined, keyboard: KeyboardPlatform) =>
  shortcut ? spokenShortcut(shortcut, keyboard) : 'no key';

function Keyboard() {
  const source = use(CommandSourceContext);
  if (!source) throw new Error('The Keyboard section needs a CommandSourceContext');
  const { registry, keyboard } = source;
  const { settings } = useAppServices();
  const overrides = useSetting(SHORTCUT_OVERRIDES_SETTING);
  const [filter, setFilter] = useState('');
  const [recording, setRecording] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [status, setStatus] = useState('');
  // The command whose key button takes focus once the row has re-rendered.
  const focusBack = useRef<string | undefined>(undefined);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const statusId = useId();

  const commands = registry.list();
  const natives = useMemo(
    () =>
      commands.flatMap((command) => {
        const key = command.native && shortcutOn(command.shortcut, keyboard);
        return key ? [key] : [];
      }),
    [commands, keyboard],
  );
  const rows = useMemo(
    () => buildRows(commands, overrides, keyboard),
    [commands, overrides, keyboard],
  );
  const shown = useMemo(() => filterRows(rows, filter, keyboard), [rows, filter, keyboard]);
  const categories = [...new Set(shown.map((row) => row.category))];

  // After every render: the row has the new text by now, and the key button exists again.
  useLayoutEffect(() => {
    if (focusBack.current === undefined || recording !== undefined || pending !== undefined) return;
    buttons.current.get(focusBack.current)?.focus();
    focusBack.current = undefined;
  });

  const stop = (command: Command, message?: string) => {
    setRecording(undefined);
    setPending(undefined);
    focusBack.current = command.id;
    if (message !== undefined) setStatus(message);
  };

  const apply = (command: Command, overridesNext: typeof overrides, message: string) => {
    settings.set(SHORTCUT_OVERRIDES_SETTING, overridesNext);
    stop(command, message);
  };

  const commit = (command: Command, change: Change) => {
    const plan = planChange(commands, overrides, keyboard, command, change);
    const title = command.title;
    const wanted =
      change === 'default'
        ? shortcutOn(command.shortcut, keyboard)
        : change === null
          ? undefined
          : stamp(change, keyboard);
    const keyText = wanted ? spokenShortcut(wanted, keyboard) : 'no key';
    if (plan.kind === 'same') {
      stop(command, `${title} already has ${keyText}.`);
    } else if (plan.kind === 'refused') {
      setRecording(undefined);
      setStatus(
        `${keyText} is ${plan.other.title}'s key, which cannot be changed. Pick another key.`,
      );
      focusBack.current = command.id;
    } else if (plan.kind === 'conflict') {
      setRecording(undefined);
      setPending({ command, plan, binding: wanted });
    } else {
      const note = plan.shadow
        ? plan.shadow.kind === 'over'
          ? ` While editing, ${keyText} runs ${title} instead of ${plan.shadow.other.title}.`
          : ` While editing, ${keyText} runs ${plan.shadow.other.title} instead.`
        : '';
      apply(
        command,
        plan.overrides,
        (wanted ? `${title} is now ${keyText}.` : `${title} has no key now.`) + note,
      );
    }
  };

  const swap = () => {
    if (!pending) return;
    const { command, plan, binding } = pending;
    apply(
      command,
      plan.overrides,
      `${command.title} is now ${spokenOf(binding, keyboard)}. ${plan.other.title} ${
        plan.otherGets ? `takes ${spokenOf(plan.otherGets, keyboard)}` : 'has no key now'
      }.`,
    );
  };

  const promptSentence = (value: Pending) => {
    const { plan, binding } = value;
    const key = binding ? formatShortcut(binding, keyboard) : '';
    const other = plan.otherGets
      ? `${plan.other.title} takes ${formatShortcut(plan.otherGets, keyboard)}`
      : `${plan.other.title} will have no key`;
    return `${key} is ${plan.other.title}'s key. Swap: ${value.command.title} gets ${key}, ${other}.`;
  };

  const refuse = (command: Command, reason: RefuseReason) => {
    setStatus(REFUSALS[reason]);
    // Keep recording: the user picks another key.
    setRecording(command.id);
  };

  const renderRow = (row: Row) => {
    const prompt =
      pending !== undefined && row.slots.some((slot) => slot.command.id === pending.command.id);
    return (
      <li key={row.id} className="border-b py-1.5 last:border-b-0">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm">
            {row.title}
            {row.context === 'Editing' && <span className="text-muted-foreground"> (editing)</span>}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
            {row.slots.map((slot, index) => (
              <KeySlot
                key={slot.command.id}
                slot={slot}
                position={
                  row.slots.length > 1
                    ? `${String(index + 1)} of ${String(row.slots.length)}`
                    : undefined
                }
                keyboard={keyboard}
                recording={recording === slot.command.id}
                natives={natives}
                buttonRef={(element) => {
                  if (element) buttons.current.set(slot.command.id, element);
                  else buttons.current.delete(slot.command.id);
                }}
                onRecord={() => {
                  setPending(undefined);
                  setRecording(slot.command.id);
                  setStatus('');
                }}
                onKey={(binding) => {
                  commit(slot.command, binding);
                }}
                onCancel={() => {
                  stop(slot.command, 'Cancelled.');
                }}
                onBlur={() => {
                  setRecording((now) => (now === slot.command.id ? undefined : now));
                }}
                onRefuse={(reason) => {
                  refuse(slot.command, reason);
                }}
                onClear={() => {
                  commit(slot.command, null);
                }}
                onReset={() => {
                  commit(slot.command, 'default');
                }}
              />
            ))}
          </span>
        </div>
        {prompt && (
          <ConflictPrompt
            sentence={promptSentence(pending)}
            onSwap={swap}
            onCancel={() => {
              stop(pending.command, 'Cancelled.');
            }}
          />
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3 pb-2">
      <p className="text-muted-foreground text-xs">
        Click a key, then press the new one. Escape cancels. The Guitar Pro keys are the defaults; a
        bare key still goes to a focused button or text field first. If nothing happens when you
        press a key, the system keeps it.
      </p>
      <Input
        aria-label="Filter commands or keys"
        placeholder="Filter commands or keys…"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      <p id={statusId} role="status" className="text-muted-foreground min-h-4 text-xs">
        {status}
      </p>
      {categories.length === 0 ? (
        <p className="text-muted-foreground py-4 text-sm">No matching command.</p>
      ) : (
        categories.map((category) => (
          <section key={category} aria-label={category}>
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">{category}</h3>
            <ul>{shown.filter((row) => row.category === category).map(renderRow)}</ul>
          </section>
        ))
      )}
    </div>
  );
}

export const keyboardSection: SettingsSection = {
  id: 'keyboard',
  title: 'Keyboard',
  settings: [SHORTCUT_OVERRIDES_SETTING],
  Component: Keyboard,
};
