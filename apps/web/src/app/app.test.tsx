import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { MenuCommandId } from '@/platform/bridge';
import type { Platform } from '@/platform/platform';
import { createUiStore } from '@/state/ui';

import { App } from './app';

function renderApp(openFile: Platform['openFile'] = vi.fn(() => Promise.resolve(undefined))) {
  const notUsed = () => Promise.reject(new Error('not used'));
  const platform: Platform = {
    openFile,
    saveFile: notUsed,
    readFile: notUsed,
    writeFile: notUsed,
    libraryDir: notUsed,
    dataDir: notUsed,
    print: notUsed,
    microphone: notUsed,
  };
  const ui = createUiStore('dark');
  render(<App ui={ui} platform={platform} keyboard="mac" />);
  return { ui, user: userEvent.setup() };
}

describe('App', () => {
  it('renders the frame regions', () => {
    renderApp();

    expect(screen.getByRole('complementary', { name: 'Tracks' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Score' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Transport' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
  });

  it('opens the palette with the platform shortcut and runs a command from it', async () => {
    const { ui, user } = renderApp();
    expect(document.documentElement.dataset['theme']).toBe('dark');

    await user.keyboard('{Meta>}k{/Meta}');
    const item = await screen.findByRole('option', { name: /Toggle light and dark theme/ });
    expect(screen.getByRole('option', { name: /Open file/ })).toHaveTextContent('⌘O');
    expect(screen.queryByRole('option', { name: /command palette/i })).not.toBeInTheDocument();

    await user.click(item);

    expect(ui.getState().theme).toBe('light');
    await waitFor(() => {
      expect(document.documentElement.dataset['theme']).toBe('light');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a file through the platform adapter', async () => {
    const openFile = vi.fn(() =>
      Promise.resolve({ name: 'song.gp5', bytes: new Uint8Array([1, 2, 3]) }),
    );
    const { user } = renderApp(openFile);

    await user.keyboard('{Meta>}o{/Meta}');

    expect(openFile).toHaveBeenCalledOnce();
    expect(await screen.findByText('song.gp5')).toBeInTheDocument();
  });

  it('toggles the right panel from the transport', async () => {
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Toggle panel' }));

    expect(screen.getByRole('complementary', { name: 'Panel' })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: 'Resize panel' })).toHaveAttribute(
      'aria-valuenow',
      '320',
    );
  });

  it('runs native menu commands through the registry, saving to the path Save As chose', async () => {
    const saveFile = vi.fn(() => Promise.resolve('/Users/me/song copy.gp5'));
    const writeFile = vi.fn(() => Promise.resolve());
    const print = vi.fn(() => Promise.resolve());
    const platform: Platform = {
      openFile: () => Promise.resolve({ name: 'song.gp5', bytes: new Uint8Array([1, 2]) }),
      saveFile,
      readFile: () => Promise.reject(new Error('not used')),
      writeFile,
      libraryDir: () => Promise.reject(new Error('not used')),
      dataDir: () => Promise.reject(new Error('not used')),
      print,
      microphone: () => Promise.reject(new Error('not used')),
    };
    let menu: ((id: MenuCommandId) => void) | undefined;
    const unsubscribe = vi.fn();
    const ui = createUiStore('dark');
    render(
      <App
        ui={ui}
        platform={platform}
        keyboard="mac"
        onMenuCommand={(listener) => {
          menu = listener;
          return unsubscribe;
        }}
      />,
    );
    const send = async (id: MenuCommandId) => {
      await act(async () => {
        menu?.(id);
        await Promise.resolve();
      });
    };

    await send('file.open');
    expect(await screen.findByText('song.gp5')).toBeInTheDocument();
    await send('file.saveAs');
    await send('file.save');
    await send('file.print');
    await send('view.zoomIn');
    await send('view.togglePanel');

    expect(saveFile).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith('/Users/me/song copy.gp5', new Uint8Array([1, 2]));
    expect(print).toHaveBeenCalledOnce();
    expect(ui.getState().zoom).toBe(1.1);
    expect(ui.getState().panels.rightPanel).toBe(true);
  });
});
