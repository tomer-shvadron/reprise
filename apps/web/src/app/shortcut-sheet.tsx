import { useMemo, useState } from 'react';
import { useStore } from 'zustand';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { UiStore } from '@/state/ui';

import type { CommandRegistry } from './command-registry';
import type { KeyboardPlatform } from './keyboard';
import { joinKeys, shortcutEntries } from './shortcut-table';

interface ShortcutSheetProps {
  registry: CommandRegistry;
  ui: UiStore;
  keyboard: KeyboardPlatform;
}

/** The cheat sheet (S-KEY-1): every command that has a key here, filterable, from the registry. */
export function ShortcutSheet({ registry, ui, keyboard }: ShortcutSheetProps) {
  const open = useStore(ui, (state) => state.shortcutsOpen);
  const setOpen = useStore(ui, (state) => state.setShortcutsOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        {/* Mounted only while open, so the filter starts empty each time. */}
        {open && <SheetBody registry={registry} keyboard={keyboard} />}
      </DialogContent>
    </Dialog>
  );
}

function SheetBody({
  registry,
  keyboard,
}: {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
}) {
  const [filter, setFilter] = useState('');
  const entries = useMemo(
    () =>
      shortcutEntries(registry.list(), (command) => registry.shortcutOf(command))
        .map((entry) => ({
          ...entry,
          keys: joinKeys(keyboard === 'mac' ? entry.mac : entry.other),
        }))
        .filter((entry) => entry.keys !== '—'),
    [registry, keyboard],
  );
  const wanted = filter.trim().toLowerCase();
  const shown = entries.filter(
    (entry) =>
      wanted === '' ||
      `${entry.title} ${entry.category} ${entry.context} ${entry.keys}`
        .toLowerCase()
        .includes(wanted),
  );
  const categories = [...new Set(shown.map((entry) => entry.category))];

  return (
    <>
      <DialogHeader>
        <DialogTitle>Keyboard shortcuts</DialogTitle>
        <DialogDescription>
          Type to filter by command, category or key. Editing keys work in edit mode only.
        </DialogDescription>
      </DialogHeader>
      <Input
        autoFocus
        aria-label="Filter shortcuts"
        placeholder="Filter shortcuts…"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
        }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {categories.length === 0 && (
          <p className="text-muted-foreground py-4 text-sm">No matching shortcut.</p>
        )}
        {categories.map((category) => (
          <section key={category} aria-label={category} className="mb-3">
            <h3 className="text-muted-foreground mb-1 text-xs font-medium uppercase">{category}</h3>
            <ul>
              {shown
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
                    <kbd className="text-muted-foreground font-mono text-xs">{entry.keys}</kbd>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
