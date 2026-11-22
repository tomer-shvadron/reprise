import { note, score } from '@reprise/model/testing';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Score } from '@reprise/model';
import { layoutForPrint } from '../print-layout';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { ImageExportDialog } from './image-export-dialog';
import { createImageExporter } from './image-exporter';
import bravuraJson from './outlines/bravura.json';
import geistJson from './outlines/geist.json';
import { parseOutlines } from './outlines';

function setup(selected = false, view: { bars?: number; barInView?: number } = {}) {
  const services = createTestServices();
  const builder = score().title('Demo').track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < (view.bars ?? 3); bar++) builder.bar().beat('4', [note(1, bar % 20)]);
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
    ...(view.barInView !== undefined && { barInView: () => view.barInView }),
    notify: () => undefined,
    nextPaint: () => Promise.resolve(),
    render: {
      outlines: () => Promise.resolve(parseOutlines(bravuraJson, geistJson)),
      yieldFrame: () => Promise.resolve(),
    },
  });
  renderWithServices(<ImageExportDialog exporter={exporter} />, services);
  return { exporter, saveFile, built, user: userEvent.setup() };
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

  /** The 1-based print page holding `bar`, from the layout itself rather than `pageOfBar`. */
  const expectedPage = (built: Score, bar: number, paper: 'a4' | 'letter') => {
    const { result } = layoutForPrint(
      built,
      { tracks: built.tracks.map(({ id }) => id), paper, header: true, pageNumbers: false },
      {},
      undefined,
      {},
    );
    const system = result.systems.find(({ bars }) => bar >= bars.start && bar < bars.end);
    const index = result.pages.findIndex(
      ({ systems }) =>
        system !== undefined && system.index >= systems.start && system.index < systems.end,
    );
    return index + 1;
  };

  it('starts the page field on the page in view once Page is chosen', async () => {
    const { exporter, built, user } = setup(false, { bars: 120, barInView: 100 });
    exporter.open();
    const field = await screen.findByRole('spinbutton', { name: 'Page number' });
    // Nothing is laid out for the default scope.
    expect((field as HTMLInputElement).value).toBe('1');
    await user.click(screen.getByRole('radio', { name: /^Page/ }));
    const want = expectedPage(built, 100, 'a4');
    expect(want).toBeGreaterThan(1);
    await waitFor(() => {
      expect((field as HTMLInputElement).value).toBe(String(want));
    });
  });

  it('follows a paper change until the user types a page', async () => {
    const { exporter, built, user } = setup(false, { bars: 120, barInView: 100 });
    exporter.open();
    const field = await screen.findByRole<HTMLInputElement>('spinbutton', { name: 'Page number' });
    await user.click(screen.getByRole('radio', { name: /^Page/ }));
    await waitFor(() => {
      expect(field.value).toBe(String(expectedPage(built, 100, 'a4')));
    });
    exporter.update({ paper: 'letter' });
    await waitFor(() => {
      expect(field.value).toBe(String(expectedPage(built, 100, 'letter')));
    });
    await user.clear(field);
    await user.type(field, '2');
    exporter.update({ paper: 'a4' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field.value).toBe('2');
  });

  it('keeps page 1 when the view is at the first bar', async () => {
    const { exporter, user } = setup(false, { bars: 120, barInView: 0 });
    exporter.open();
    await user.click(await screen.findByRole('radio', { name: /^Page/ }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Page number' }).value).toBe(
      '1',
    );
  });

  it('Cancel closes it', async () => {
    const { exporter, user } = setup();
    exporter.open();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
