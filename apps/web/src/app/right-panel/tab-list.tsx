import { useRef, type KeyboardEvent, type ReactNode } from 'react';

import { keepFocus } from '@/app/command-control';
import { CommandTooltip } from '@/app/command-tooltip';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import type { RegisteredCommandId } from '@/app/use-command';
import type { PanelView } from '@/state/ui';
import { cn } from 'cn';

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  /** The view the tab shows, which its context menu is about. */
  view: PanelView;
  command: RegisteredCommandId;
}

interface TabListProps<Id extends string> {
  label: string;
  items: readonly TabItem<Id>[];
  selected: Id;
  /** The id prefix that links each tab to its panel (`${idPrefix}-tab-x`, `${idPrefix}-panel`). */
  idPrefix: string;
  onSelect: (id: Id) => void;
  className?: string;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string) => `${prefix}-panel`;

function Tab({
  item,
  selected,
  idPrefix,
  onSelect,
  register,
}: {
  item: TabItem<string>;
  selected: boolean;
  idPrefix: string;
  onSelect: () => void;
  register: (node: HTMLButtonElement | null) => void;
}) {
  const menu = useStaticContextMenu({
    surface: 'panel.tab',
    target: { kind: 'panel', view: item.view },
    label: `${item.label} tab`,
  });
  const button = (
    <button
      ref={register}
      type="button"
      role="tab"
      {...menu}
      id={tabId(idPrefix, item.id)}
      aria-selected={selected}
      // One shared panel, labelled by the selected tab, so only that tab controls it.
      aria-controls={selected ? panelId(idPrefix) : undefined}
      // The roving tab stop: only the selected tab is in the Tab order, arrows move inside.
      tabIndex={selected ? 0 : -1}
      onMouseDown={keepFocus}
      onClick={onSelect}
      className={cn(
        'text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mb-px border-b-2 border-transparent px-[3px] py-1.5 text-xs font-medium outline-none focus-visible:ring-2',
        selected && 'border-primary text-foreground',
      )}
    >
      {item.label}
    </button>
  );
  // A tooltip that only repeats the label would pop up at every arrow stop; it shows for the key.
  return (
    <CommandTooltip command={item.command} label={item.label} whenUnbound="none">
      {button}
    </CommandTooltip>
  );
}

/**
 * The WAI-ARIA tabs pattern with automatic activation: Left and Right move between tabs (and
 * wrap), Home and End jump to the ends, and the arrival selects.
 */
export function TabList<Id extends string>({
  label,
  items,
  selected,
  idPrefix,
  onSelect,
  className,
}: TabListProps<Id>): ReactNode {
  const nodes = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent) => {
    const current = items.findIndex((item) => item.id === selected);
    const last = items.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? current === last
          ? 0
          : current + 1
        : event.key === 'ArrowLeft'
          ? current === 0
            ? last
            : current - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    const target = next === undefined ? undefined : items[next];
    if (!target) return;
    event.preventDefault();
    onSelect(target.id);
    nodes.current.get(target.id)?.focus();
  };

  // The keys are handled on the tablist, where the tabs' key events bubble to.
  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={cn('flex shrink-0 overflow-x-auto border-b', className)}
    >
      {items.map((item) => (
        <Tab
          key={item.id}
          item={item}
          selected={item.id === selected}
          idPrefix={idPrefix}
          onSelect={() => {
            onSelect(item.id);
          }}
          register={(node) => {
            if (node) nodes.current.set(item.id, node);
            else nodes.current.delete(item.id);
          }}
        />
      ))}
    </div>
  );
}
