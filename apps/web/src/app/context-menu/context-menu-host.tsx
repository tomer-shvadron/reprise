import { useEffect, useRef, type PointerEvent, type ReactNode, type SyntheticEvent } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { runCommand, type Command, type CommandRegistry } from '../command-registry';
import { type KeyboardPlatform } from '../keyboard';
import { useAppServices } from '../services-context';
import { activatesOnSpace } from '../shortcut-dispatcher';
import { bindCommand } from '../use-command';
import type { MenuRegistry } from './menu-registry';
import { resolveMenu, type ResolvedEntry } from './resolve-menu';

interface HostProps {
  registry: CommandRegistry;
  menus: MenuRegistry;
  keyboard: KeyboardPlatform;
}

function MenuEntries({
  entries,
  registry,
  keyboard,
  choose,
  onPointerUp,
}: {
  entries: readonly ResolvedEntry[];
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
  choose: (command: Command) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
}): ReactNode {
  return entries.map((entry, index) => {
    if (entry.kind === 'separator')
      return <DropdownMenuSeparator key={`separator-${String(index)}`} />;
    if (entry.kind === 'submenu') {
      return (
        <DropdownMenuSub key={`submenu-${entry.title}`}>
          <DropdownMenuSubTrigger>{entry.title}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <MenuEntries
              entries={entry.entries}
              registry={registry}
              keyboard={keyboard}
              choose={choose}
              onPointerUp={onPointerUp}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      );
    }
    const bound = bindCommand({ registry, keyboard }, entry.id);
    const common = {
      disabled: !entry.enabled,
      'data-command': entry.command.id,
      'aria-keyshortcuts': bound.ariaKeys,
      onPointerUp,
      onSelect: () => {
        choose(entry.command);
      },
    };
    const keys = bound.keys && (
      <DropdownMenuShortcut className={entry.checked === undefined ? undefined : 'mr-4'}>
        {bound.keys}
      </DropdownMenuShortcut>
    );
    if (entry.checked !== undefined) {
      return (
        <DropdownMenuCheckboxItem key={entry.command.id} checked={entry.checked} {...common}>
          {entry.label}
          {keys}
        </DropdownMenuCheckboxItem>
      );
    }
    return (
      <DropdownMenuItem
        key={entry.command.id}
        variant={entry.group === 'danger' ? 'destructive' : 'default'}
        {...common}
      >
        {entry.label}
        {keys}
      </DropdownMenuItem>
    );
  });
}

/**
 * The one context menu of the app, a controlled Radix dropdown menu opened from code: a surface
 * asks the context-menu store, this host shows the resolved entries at the point. It is not
 * Radix's `ContextMenu`, whose root cannot be opened from code (Shift+F10 on macOS raises no
 * event) and which wants a trigger around every surface.
 *
 * The chosen command runs only after focus is back where it was, so a dialog it opens remembers
 * the right element to return to, and Space still plays afterwards.
 */
export function ContextMenuHost({ registry, menus, keyboard }: HostProps) {
  const services = useAppServices();
  const { contextMenu, menuTarget, editing } = services;
  // Not the whole store: it is written on every press in the window.
  const { open, request, point, via } = useStore(
    contextMenu,
    useShallow((state) => ({
      open: state.open,
      request: state.request,
      point: state.point,
      via: state.via,
    })),
  );
  const mode = useStore(editing, (state) => (state.editing ? 'edit' : 'play'));
  const chosen = useRef<Command | undefined>(undefined);
  // Whether a press has begun inside the menu since it opened. The release of the right-click
  // that opened it lands on an item whenever the menu appears under the pointer (it slides in),
  // and Radix would select that item as if it had been pressed.
  const pressedInside = useRef(false);
  // A native right-press, drag and release cannot choose an item: a deliberate v1 trade for a
  // guard that needs no timer.
  useEffect(() => {
    if (!open) return;
    pressedInside.current = false;
    // A menu opened again before the last one finished closing keeps its content mounted, so
    // no close-focus callback ran for the first: its choice must not run on the second's target.
    chosen.current = undefined;
  }, [open]);

  // Before the browser moves focus on a press, so a right-click on a control that takes focus
  // still returns to what had it.
  useEffect(() => {
    const remember = () => {
      contextMenu.getState().rememberPress(globalThis.document.activeElement);
    };
    window.addEventListener('pointerdown', remember, true);
    return () => {
      window.removeEventListener('pointerdown', remember, true);
    };
  }, [contextMenu]);

  const onCloseAutoFocus = (event: Event | SyntheticEvent) => {
    event.preventDefault();
    const invoker = contextMenu.getState().takeInvoker();
    if (
      invoker instanceof HTMLElement &&
      invoker.isConnected &&
      invoker !== globalThis.document.body
    ) {
      invoker.focus();
    } else {
      // Nothing to restore: a control left focused would take the next Space as a press.
      const active = globalThis.document.activeElement;
      if (active instanceof HTMLElement && activatesOnSpace(active)) active.blur();
    }
    const command = chosen.current;
    chosen.current = undefined;
    if (command) runCommand(command);
    menuTarget.getState().clear();
  };

  const entries =
    request === undefined
      ? []
      : resolveMenu(
          menus,
          registry,
          request.surface,
          { services, target: request.target, mode },
          keyboard,
        );

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        if (!next) contextMenu.getState().hide();
      }}
    >
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          data-context-menu-anchor=""
          // Never in the way of a click on what lies under the last point.
          style={{
            position: 'fixed',
            left: point.x,
            top: point.y,
            width: 1,
            height: 1,
            pointerEvents: 'none',
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={2}
        aria-label={request?.label}
        // Radix names the menu after its trigger, which here is an empty anchor.
        aria-labelledby={undefined}
        data-context-menu={request?.surface}
        data-context-menu-via={via}
        className="w-auto min-w-48"
        onCloseAutoFocus={onCloseAutoFocus}
        onPointerDownCapture={() => {
          pressedInside.current = true;
        }}
      >
        <MenuEntries
          entries={entries}
          registry={registry}
          keyboard={keyboard}
          choose={(command) => {
            chosen.current = command;
          }}
          onPointerUp={(event) => {
            // Radix skips its own release-selects-item handling when this is prevented.
            if (!pressedInside.current) event.preventDefault();
          }}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
