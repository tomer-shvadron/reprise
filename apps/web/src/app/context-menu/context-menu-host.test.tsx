import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

import { createAppMenus } from '../app-menus';
import { createAppRegistry } from '../app-registry';
import { AppHeader } from '../header/app-header';
import { AppServicesProvider } from '../services-context';
import { CommandSourceContext } from '../use-command';
import { ContextMenuHost } from './context-menu-host';
import { openContextMenuOn } from './open-on';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStaticContextMenu } from './use-context-menu';

function Field({ portal }: { portal: boolean }) {
  const menu = useStaticContextMenu({
    surface: 'header',
    target: { kind: 'header', element: 'band' },
    label: 'Band',
  });
  return (
    <div {...menu}>
      <input aria-label="Tempo" />
      {portal && (
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>Options</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Portaled item</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function setup(keyboard: 'mac' | 'other' = 'mac', portal = false) {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  const menus = createAppMenus(registry);
  render(
    <AppServicesProvider services={services}>
      <TooltipProvider>
        <CommandSourceContext value={{ registry, keyboard }}>
          <AppHeader />
          <Field portal={portal} />
          <ContextMenuHost registry={registry} menus={menus} keyboard={keyboard} />
        </CommandSourceContext>
      </TooltipProvider>
    </AppServicesProvider>,
  );
  return { services, registry };
}

const crumb = () => screen.getByRole('button', { name: 'Library' });

describe('the context menu host', () => {
  it('opens at the pointer on a right-click, with the keys and the target set', async () => {
    const { services } = setup();
    fireEvent.contextMenu(crumb(), { clientX: 40, clientY: 12 });

    const menu = await screen.findByRole('menu', { name: 'Library' });
    expect(menu).toHaveAttribute('data-context-menu', 'header');
    expect(services.menuTarget.getState().target).toEqual({ kind: 'header', element: 'crumb' });
    const anchor = document.querySelector<HTMLElement>('[data-context-menu-anchor]');
    expect(anchor).toHaveStyle({ left: '40px', top: '12px' });

    const show = within(menu).getByRole('menuitem', { name: /Show library/ });
    expect(show).toHaveAttribute('data-command', 'library.show');
  });

  it('shows the registry keys on an item, in the platform notation', async () => {
    setup();
    fireEvent.contextMenu(screen.getByRole('banner'));
    const item = await screen.findByRole('menuitem', { name: /Show command palette/ });
    expect(item).toHaveTextContent('⌘K');
    expect(item).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
  });

  it('chooses with the arrows and Enter, runs the command after the menu closed, then clears the target', async () => {
    const { services, registry } = setup();
    const run = vi
      .spyOn(registry.get('library.show') ?? missing(), 'run')
      .mockImplementation(() => {
        // The target is still set while the command runs, so it can read it.
        expect(services.menuTarget.getState().target).toBeDefined();
      });
    fireEvent.contextMenu(crumb());
    await screen.findByRole('menu');

    await userEvent.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => {
      expect(run).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(services.menuTarget.getState().target).toBeUndefined();
  });

  it('does not select the item under the pointer when the opening right-click is released', async () => {
    setup();
    fireEvent.contextMenu(crumb());
    const item = await screen.findByRole('menuitem', { name: /Show library/ });
    fireEvent.pointerUp(item);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    // A press inside the menu, then its release, chooses as usual.
    fireEvent.pointerDown(item);
    fireEvent.pointerUp(item);
    fireEvent.click(item);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
  });

  it('returns focus to the invoker on Escape after a keyboard open, running nothing', async () => {
    const { services } = setup();
    crumb().focus();
    act(() => {
      openContextMenuOn(crumb());
    });
    await screen.findByRole('menu', { name: 'Library' });
    expect(services.contextMenu.getState().via).toBe('keyboard');

    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    expect(crumb()).toHaveFocus();
    expect(services.menuTarget.getState().target).toBeUndefined();
  });

  it('returns focus to what had it before a right-click', async () => {
    setup();
    const field = screen.getByRole('button', { name: 'Search commands' });
    field.focus();
    // The press happens first and could move focus; the host recorded the focus before it.
    fireEvent.pointerDown(crumb());
    crumb().focus();
    fireEvent.contextMenu(crumb());
    await screen.findByRole('menu');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(field).toHaveFocus();
    });
  });

  it('ignores a right-click inside portaled content under a surface', async () => {
    setup('mac', true);
    const item = await screen.findByRole('menuitem', { name: 'Portaled item' });
    const allowed = fireEvent.contextMenu(item);
    expect(allowed).toBe(true);
    expect(document.querySelector('[data-context-menu]')).toBeNull();
  });

  it('says on the content whether the menu was opened by pointer or by keyboard', async () => {
    setup();
    fireEvent.contextMenu(crumb());
    const menu = await screen.findByRole('menu', { name: 'Library' });
    expect(menu).toHaveAttribute('data-context-menu-via', 'pointer');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    act(() => {
      openContextMenuOn(crumb());
    });
    expect(await screen.findByRole('menu', { name: 'Library' })).toHaveAttribute(
      'data-context-menu-via',
      'keyboard',
    );
  });

  it('leaves the browser menu on a text field', () => {
    setup();
    const allowed = fireEvent.contextMenu(screen.getByRole('textbox', { name: 'Tempo' }));
    expect(allowed).toBe(true);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('opens the focused surface from the app.contextMenu command', async () => {
    const { registry } = setup('mac');
    crumb().focus();
    act(() => {
      void registry.get('app.contextMenu')?.run();
    });
    expect(await screen.findByRole('menu', { name: 'Library' })).toBeInTheDocument();
  });

  it('lists no editing command in play mode and shows the mode item per mode', async () => {
    const { services } = setup();
    fireEvent.contextMenu(screen.getByRole('radiogroup', { name: 'Mode' }));
    expect(await screen.findByRole('menuitem', { name: /^Edit mode/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });
    act(() => {
      services.editing.getState().setEditing(true);
    });
    fireEvent.contextMenu(screen.getByRole('radiogroup', { name: 'Mode' }));
    expect(await screen.findByRole('menuitem', { name: /^Play mode/ })).toBeInTheDocument();
  });
});

function missing(): never {
  throw new Error('command missing');
}
