import { useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { SettingsStore } from '@/state/settings';
import type { UiStore } from '@/state/ui';

import type { CommandRegistry } from './command-registry';
import type { KeyboardPlatform } from './keyboard';
import { useKeyOverrides } from './use-command';
import { filterWords, joinKeys, searchText, shortcutEntries } from './shortcut-table';

interface ShortcutSheetProps {
  registry: CommandRegistry;
  ui: UiStore;
  settings: Pick<SettingsStore, 'get' | 'subscribe'>;
  keyboard: KeyboardPlatform;
}

/** The cheat sheet (S-KEY-1): every command that has a key here, filterable, from the registry. */
export function ShortcutSheet({ registry, ui, settings, keyboard }: ShortcutSheetProps) {
  const open = useStore(ui, (state) => state.shortcutsOpen);
  const setOpen = useStore(ui, (state) => state.setShortcutsOpen);
  const [filter, setFilter] = useState('');
  // Not read: a changed key re-renders the sheet and recomputes its rows.
  const overrides = useKeyOverrides(settings);
  // The filter takes focus as Radix focuses the first tabbable element, after `onOpenAutoFocus`
  // has noted where focus was. The sheet has no trigger element for Radix to give focus back to, so it remembers its own.
  const opener = useRef<HTMLElement | null>(null);
  // Each opening starts with an empty filter; clearing it on close would flash the full list
  // while the dialog fades out.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setFilter('');
  }

  const entries = useMemo(
    () =>
      shortcutEntries(registry.list(), (command) => registry.shortcutOf(command))
        .map((entry) => {
          const spoken = entry.spoken[keyboard].join(' or ');
          return {
            ...entry,
            keys: joinKeys(keyboard === 'mac' ? entry.mac : entry.other),
            spoken,
            haystack: searchText(
              `${entry.title} ${entry.category} ${entry.context} ${joinKeys(entry.mac)} ${joinKeys(entry.other)} ${spoken}`,
            ),
          };
        })
        .filter((entry) => entry.keys !== '—'),
    // The overrides are read through the registry's keys; naming them re-computes on a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registry, keyboard, overrides],
  );
  const words = filterWords(filter);
  const shown = entries.filter((entry) => words.every((word) => entry.haystack.includes(word)));
  const categories = [...new Set(shown.map((entry) => entry.category))];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-shortcut-sheet=""
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          opener.current?.focus();
        }}
        className="flex max-h-[80vh] flex-col sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Type to filter by command, category or key. Editing keys work in edit mode only. Change
            a key in Settings, Keyboard.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Filter shortcuts"
          placeholder="Filter shortcuts…"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {categories.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">No matching shortcut.</p>
          ) : (
            <ul aria-label="Shortcuts">
              {categories.flatMap((category) => [
                <li
                  key={category}
                  className="text-muted-foreground mt-3 mb-1 text-xs font-medium uppercase first:mt-0"
                >
                  {category}
                </li>,
                ...shown
                  .filter((entry) => entry.category === category)
                  .map((entry) => (
                    <li
                      key={`${entry.context}:${entry.title}`}
                      className="flex items-baseline justify-between gap-4 py-0.5 text-sm"
                    >
                      <span>
                        {entry.title}
                        {entry.context === 'Editing' && (
                          <span className="text-muted-foreground"> (editing)</span>
                        )}
                      </span>
                      <kbd
                        aria-label={entry.spoken}
                        className="text-muted-foreground font-mono text-xs"
                      >
                        {entry.keys}
                      </kbd>
                    </li>
                  )),
              ])}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
