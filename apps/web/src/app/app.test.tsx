import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { stubViewport } from '@/features/score/test/viewport-stub';
import type { MenuCommandId } from '@/platform/bridge';
import type { Platform } from '@/platform/platform';
import { createTestServices, fakePlatform } from '@/test/services';

import { App } from './app';

function renderApp(platform: Platform = fakePlatform()) {
  const services = createTestServices({ platform });
  let menu: ((id: MenuCommandId) => void) | undefined;
  render(
    <App
      services={services}
      keyboard="mac"
      onMenuCommand={(listener) => {
        menu = listener;
        return () => undefined;
      }}
    />,
  );
  const send = async (id: MenuCommandId) => {
    await act(async () => {
      menu?.(id);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  return { services, send, user: userEvent.setup() };
}

async function riffBytes(): Promise<Uint8Array> {
  return (await write(score().title('Riff').build(), 'reprise')).bytes;
}

describe('App', () => {
  it('renders the frame regions and the empty state', () => {
    renderApp();

    expect(screen.getByRole('complementary', { name: 'Tracks' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Score' })).toHaveTextContent('Open a file (⌘O)');
    expect(screen.getByRole('contentinfo', { name: 'Transport' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
    expect(screen.queryByRole('complementary', { name: 'Panel' })).not.toBeInTheDocument();
  });

  it('opens the palette with the platform shortcut and runs a command from it', async () => {
    const { services, user } = renderApp();
    expect(document.documentElement.dataset['theme']).toBe('dark');

    await user.keyboard('{Meta>}k{/Meta}');
    const item = await screen.findByRole('option', { name: /Toggle light and dark theme/ });
    expect(screen.getByRole('option', { name: /Open file/ })).toHaveTextContent('⌘O');
    expect(screen.getByRole('option', { name: /Play or pause/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /command palette/i })).not.toBeInTheDocument();

    await user.click(item);

    expect(services.ui.getState().theme).toBe('light');
    await waitFor(() => {
      expect(document.documentElement.dataset['theme']).toBe('light');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a file through the platform adapter and paints it', async () => {
    stubViewport(1280, 800);
    const bytes = await riffBytes();
    const openFile = vi.fn(() => Promise.resolve({ name: 'riff.reprise', bytes }));
    const { services, user } = renderApp(fakePlatform({ openFile }));

    await user.keyboard('{Meta>}o{/Meta}');

    const region = await screen.findByRole('region', { name: 'Score: Riff' });
    expect(openFile).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(region.querySelector('[data-system-id]')).not.toBeNull();
    });
    const { id, score: opened } = services.document.getState();
    expect(services.fakeAudio.setDocument).toHaveBeenLastCalledWith({ id, score: opened });
  });

  it('unlocks audio on the first gesture only', async () => {
    const { services, user } = renderApp();

    await user.click(screen.getByRole('main', { name: 'Score' }));
    await user.keyboard('a');

    expect(services.fakeAudio.unlock).toHaveBeenCalledOnce();
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

  it('runs native menu commands through the registry, saving in place after Save As', async () => {
    const bytes = await riffBytes();
    const saveFile = vi.fn(() => Promise.resolve('/Users/me/riff.reprise'));
    const writeHandle = vi.fn(() => Promise.resolve());
    const print = vi.fn(() => Promise.resolve());
    const platform = fakePlatform({
      openFile: () => Promise.resolve({ name: 'riff.gp5', bytes }),
      saveFile,
      writeHandle,
      print,
    });
    const { services, send, user } = renderApp(platform);

    await send('file.open');
    await waitFor(() => {
      expect(services.document.getState().score).toBeDefined();
    });
    await send('file.save');
    const dialog = await screen.findByRole('dialog', { name: 'Save as' });
    await user.click(within(dialog).getByRole('button', { name: 'Reprise' }));
    await waitFor(() => {
      expect(services.document.getState().saving).toBe(false);
    });
    await send('file.save');
    await send('file.print');
    await send('view.zoomIn');
    await send('view.togglePanel');

    expect(saveFile).toHaveBeenCalledOnce();
    expect(saveFile).toHaveBeenCalledWith('riff.reprise', expect.anything(), [
      { name: 'Reprise', extensions: ['reprise'] },
    ]);
    expect(writeHandle).toHaveBeenCalledWith('/Users/me/riff.reprise', expect.anything());
    expect(print).toHaveBeenCalledOnce();
    expect(services.ui.getState().zoom).toBe(1.1);
    expect(services.ui.getState().panels.rightPanel).toBe(true);
  });

  it('asks before overwriting an opened .gp with what will be lost, and keeps it a .gp', async () => {
    const { bytes } = await write(score().title('Timer').build(), 'gp');
    const handle = { kind: 'file' };
    const writeHandle = vi.fn(() => Promise.resolve());
    const platform = fakePlatform({
      openFile: () => Promise.resolve({ name: 'timer.gp', bytes, handle }),
      writeHandle,
    });
    const { services, send, user } = renderApp(platform);
    await send('file.open');
    await waitFor(() => {
      expect(services.document.getState().score).toBeDefined();
    });
    // What a real Guitar Pro file's read reports: something the model does not hold.
    act(() => {
      services.document.setState({
        warnings: [
          { code: 'rse-dropped', severity: 'info', message: 'RSE settings', location: {} },
        ],
      });
    });

    await send('file.save');
    const dialog = await screen.findByRole('dialog', { name: 'Save timer.gp?' });
    expect(dialog).toHaveTextContent('RSE settings');
    expect(within(dialog).getByRole('list', { name: 'What will be lost' })).toBeInTheDocument();
    expect(writeHandle).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(writeHandle).toHaveBeenCalledWith(handle, expect.any(Uint8Array));
    });
    expect(services.document.getState().file).toMatchObject({ name: 'timer.gp', format: 'gp' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
