import { note, score } from '@reprise/model/testing';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { ImageExportDialog } from './image-export-dialog';
import { createImageExporter } from './image-exporter';
import bravuraJson from './outlines/bravura.json';
import geistJson from './outlines/geist.json';
import { parseOutlines } from './outlines';

function setup(selected = false) {
  const services = createTestServices();
  const builder = score().title('Demo').track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < 3; bar++) builder.bar().beat('4', [note(1, bar)]);
  const built = builder.build({ ids: 'sequential' });
  services.document.setState({ score: built });
  const saveFile = vi.fn<(name: string, bytes: Uint8Array) => Promise<string | undefined>>(() =>
    Promise.resolve('/x/out'),
  );
  const exporter = createImageExporter({
    document: services.document,
    ui: services.ui,
    platform: fakePlatform({ saveFile }),
    selectionScope: () =>
      selected
        ? { tracks: built.tracks.map(({ id }) => id), bars: { start: 0, end: 2 } }
        : undefined,
    notify: () => undefined,
    render: {
      outlines: () => Promise.resolve(parseOutlines(bravuraJson, geistJson)),
      yieldFrame: () => Promise.resolve(),
    },
  });
  renderWithServices(<ImageExportDialog exporter={exporter} />, services);
  return { exporter, saveFile, user: userEvent.setup() };
}

describe('ImageExportDialog', () => {
  it('shows nothing until opened, then the defaults, with Scale for PNG only', async () => {
    const { exporter, user } = setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    exporter.open();
    expect(await screen.findByRole('dialog', { name: 'Export as image' })).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Whole score' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: /Selected bar/ })).toBeNull();
    expect(screen.getByRole('radio', { name: '2×' })).toBeChecked();
    expect(screen.getByText('Exported in print colours.')).toBeVisible();
    await user.click(screen.getByRole('radio', { name: 'SVG' }));
    expect(screen.queryByRole('radio', { name: '2×' })).toBeNull();
  });

  it('offers the selected bars and starts on them', async () => {
    const { exporter } = setup(true);
    exporter.open();
    expect(await screen.findByRole('radio', { name: 'Selected bars 1–2' })).toBeChecked();
  });

  it('disables Export for a bad page number and exports an SVG otherwise', async () => {
    const { exporter, saveFile, user } = setup();
    exporter.open();
    await user.click(await screen.findByRole('radio', { name: 'SVG' }));
    await user.click(screen.getByRole('radio', { name: /^Page/ }));
    const field = screen.getByRole('spinbutton', { name: 'Page number' });
    await user.clear(field);
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    await user.type(field, '1');
    await user.click(screen.getByRole('button', { name: 'Export' }));
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(saveFile.mock.calls[0]?.[0]).toBe('Demo p1.svg');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Cancel closes it', async () => {
    const { exporter, user } = setup();
    exporter.open();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
