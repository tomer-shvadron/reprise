import { write } from '@reprise/formats';
import { setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { PickedFile, Platform } from '@/platform/platform';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakeDownload, fakePlatform } from '@/test/services';
import { createMemoryStorage } from '@/test/memory-storage';

import { CURATED_PACKS } from './curated-packs';
import { packContents, zipOf } from './test/pack-fixtures';
import { SoundManager } from './sound-manager';

const [SWAG, GROWLY] = CURATED_PACKS;
if (!SWAG || !GROWLY) throw new Error('the curated list is empty');

/** A zip holding the pack a curated manifest promises: each entry an SFZ over one shared sample. */
async function curatedZip(manifest = SWAG) {
  const base = packContents();
  const contents = new Map<string, Uint8Array>();
  const wav = base.get('samples/a.wav');
  if (!wav) throw new Error('no sample');
  contents.set('s/a.wav', wav);
  for (const instrument of manifest?.instruments ?? []) {
    for (const path of Object.values(instrument.entries)) {
      contents.set(
        path,
        new TextEncoder().encode('<region> sample=s/a.wav lokey=0 hikey=127 pitch_keycenter=60\n'),
      );
    }
  }
  return zipOf(contents, 'Swagbass/');
}

function picked(name: string, bytes: Uint8Array): PickedFile {
  return {
    name,
    relativePath: name,
    size: bytes.length,
    read: (range) =>
      Promise.resolve(range ? bytes.slice(range.offset, range.offset + range.length) : bytes),
  };
}

function setup(overrides: Partial<Platform> = {}) {
  const storage = createMemoryStorage();
  const openFiles = vi.fn<Platform['openFiles']>(() => Promise.resolve([]));
  const openFolder = vi.fn<Platform['openFolder']>(() => Promise.resolve(undefined));
  const platform = fakePlatform({ ...storage.calls, openFiles, openFolder, ...overrides });
  const services = createTestServices({ platform });
  const view = renderWithServices(<SoundManager />, services);
  return { services, storage, platform, view, openFiles, openFolder, user: userEvent.setup() };
}

const row = (name: string): HTMLElement => {
  const element = screen.getByRole('heading', { name }).closest('li');
  if (!element) throw new Error(`no row for ${name}`);
  return element;
};

describe('SoundManager: the lists', () => {
  it('lists the curated packs with their licence links, and leaves a slot for the memory readout', () => {
    const { view } = setup();
    expect(screen.getByRole('heading', { name: 'Sounds' })).toBeInTheDocument();
    expect(screen.getByText('No sound packs are installed.')).toBeInTheDocument();
    for (const pack of CURATED_PACKS) {
      const item = row(pack.name);
      const licence = within(item).getByRole('link', { name: pack.licenseName ?? '' });
      expect(licence).toHaveAttribute('href', pack.licenseUrl);
      expect(licence).toHaveAttribute('target', '_blank');
      expect(licence.getAttribute('rel')).toContain('noreferrer');
    }
    expect(view.container.querySelector('[data-slot="memory-readout"]')).not.toBeNull();
  });

  it('offers the download page and a zip on a platform without download', () => {
    setup();
    const item = row(SWAG.name);
    expect(within(item).getByRole('link', { name: 'Open download page' })).toHaveAttribute(
      'href',
      SWAG.sourceUrl,
    );
    expect(
      within(item).getByRole('button', { name: `Choose zip for ${SWAG.name}` }),
    ).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: `Download ${SWAG.name}` })).toBeNull();
  });

  it('offers Download on a platform that can download', () => {
    setup({ download: vi.fn() });
    const item = row(SWAG.name);
    expect(within(item).getByRole('button', { name: `Download ${SWAG.name}` })).toBeInTheDocument();
    expect(within(item).queryByRole('link', { name: 'Open download page' })).toBeNull();
  });

  it('lists a damaged folder and removes it', async () => {
    const storage = createMemoryStorage();
    const platform = fakePlatform({ ...storage.calls });
    await platform.writeFile('data/sounds/Broken000001/files/a.sfz', new Uint8Array(1));
    const services = createTestServices({ platform });
    await act(async () => {
      await services.sounds.scan();
    });
    renderWithServices(<SoundManager />, services);
    expect(screen.getByText(/Damaged:/)).toBeInTheDocument();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Remove damaged folder Broken000001' }));
    await waitFor(() => {
      expect(screen.queryByText(/Damaged:/)).toBeNull();
    });
  });
});

describe('SoundManager: installing', () => {
  it('chooses a zip for a curated pack and lists it installed', async () => {
    const bytes = await curatedZip();
    const { user, openFiles } = setup();
    openFiles.mockResolvedValueOnce([picked('Swagbass.zip', bytes)]);
    await user.click(screen.getByRole('button', { name: `Choose zip for ${SWAG.name}` }));
    const installed = await screen.findByLabelText('Installed packs');
    await waitFor(() => {
      expect(within(installed).getByRole('heading', { name: SWAG.name })).toBeInTheDocument();
    });
    expect(within(installed).getByText('Installed', { selector: 'span' })).toBeInTheDocument();
    // It left the Available list.
    expect(screen.getByLabelText('Available packs')).not.toHaveTextContent(SWAG.name);
  });

  it('installs a custom pack from a zip, renames it, and removes it after a confirm', async () => {
    const bytes = await zipOf(packContents(), 'Pack/');
    const { user, openFiles, services } = setup();
    openFiles.mockResolvedValueOnce([picked('My bass.zip', bytes)]);
    await user.click(screen.getByRole('button', { name: 'Install from zip…' }));
    const name = await screen.findByRole('heading', { name: 'My bass' });
    expect(within(row('My bass')).getByText(/Custom pack/)).toBeInTheDocument();

    await user.click(within(row('My bass')).getByRole('button', { name: 'Rename' }));
    const input = screen.getByRole('textbox', { name: 'Name of My bass' });
    await user.clear(input);
    await user.type(input, 'Fretless{Enter}');
    expect(await screen.findByRole('heading', { name: 'Fretless' })).toBeInTheDocument();
    expect(name).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Remove Fretless' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/No track of the open song uses this pack/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(services.fakeAudio.releasePack).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Fretless' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Fretless' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Fretless' })).toBeNull();
    });
    expect(services.fakeAudio.releasePack).toHaveBeenCalledOnce();
  });

  it('installs a custom pack from a folder', async () => {
    const { user, openFolder } = setup();
    const files = [...packContents()].map(([path, bytes]) => ({
      ...picked(path.split('/').pop() ?? path, bytes),
      relativePath: path,
    }));
    openFolder.mockResolvedValueOnce({
      name: 'Folder bass',
      files,
      truncated: false,
      skipped: 0,
    });
    await user.click(screen.getByRole('button', { name: 'Install from folder…' }));
    expect(await screen.findByRole('heading', { name: 'Folder bass' })).toBeInTheDocument();
  });

  it('says how many tracks of the open song use a pack before removing it', async () => {
    const { services, user, openFiles } = setup();
    const song = score().track('bass', { name: 'Low' }).build();
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    const zip = await curatedZip();
    openFiles.mockResolvedValueOnce([picked('Swagbass.zip', zip)]);
    await user.click(screen.getByRole('button', { name: `Choose zip for ${SWAG.name}` }));
    await waitFor(() => {
      expect(
        within(screen.getByLabelText('Installed packs')).getByRole('heading', { name: SWAG.name }),
      ).toBeInTheDocument();
    });
    const trackId = services.document.getState().score?.tracks[0]?.id;
    if (!trackId) throw new Error('no track');
    act(() => {
      services.document
        .getState()
        .apply(setTrackProperties({ trackId }, { sound: { packId: SWAG.id } }));
    });
    expect(within(row(SWAG.name)).getByText(/Used by 1 track/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Remove ${SWAG.name}` }));
    expect(
      within(await screen.findByRole('dialog')).getByText(/1 track of the open song use this pack/),
    ).toBeInTheDocument();
  });

  it('shows a refused install with its details, and dismisses it', async () => {
    const wrong = await zipOf(packContents({ 'default.sfz': null }), 'Swagbass/');
    const { user, openFiles } = setup();
    openFiles.mockResolvedValueOnce([picked('wrong.zip', wrong)]);
    await user.click(screen.getByRole('button', { name: `Choose zip for ${SWAG.name}` }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SWAG.name);
    expect(alert).toHaveTextContent(/swagbass\.sfz.*missing/);
    await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('downloads with progress and cancels', async () => {
    let signalOf: AbortSignal | undefined;
    const download = vi.fn(
      ({ onProgress, signal }: Parameters<NonNullable<Platform['download']>>[0]) =>
        new Promise<{ size: number }>((_resolve, reject) => {
          signalOf = signal;
          onProgress?.(50 * 1024 * 1024, 144 * 1024 * 1024);
          signal?.addEventListener('abort', () => {
            reject(new DOMException('cancelled', 'AbortError'));
          });
        }),
    );
    const { user } = setup({ download });
    await user.click(screen.getByRole('button', { name: `Download ${SWAG.name}` }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Downloading: 50 MB of 144 MB');
    expect(within(status).getByRole('progressbar')).toBeInTheDocument();
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ url: SWAG.download?.url, sha256: SWAG.download?.sha256 }),
    );
    // One install at a time: the other pack's buttons are disabled meanwhile.
    expect(
      within(row(GROWLY.name)).getByRole('button', { name: `Download ${GROWLY.name}` }),
    ).toBeDisabled();
    await user.click(within(status).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
    expect(signalOf?.aborted).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a failed download as a problem', async () => {
    const download = fakeDownload(
      { writeFile: () => Promise.resolve() },
      { fail: new Error('The download does not match its SHA-256') },
    );
    const { user } = setup({ download });
    await user.click(screen.getByRole('button', { name: `Download ${SWAG.name}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent('SHA-256');
  });
});

describe('SoundManager: drops', () => {
  const dropOn = (target: HTMLElement, files: File[]) => {
    fireEvent.drop(target, { dataTransfer: { types: ['Files'], items: [], files } });
  };

  it('installs a zip dropped on the screen as a custom pack', async () => {
    const bytes = await zipOf(packContents(), 'Pack/');
    const { view } = setup();
    dropOn(view.container.firstElementChild as HTMLElement, [
      new File([bytes as BlobPart], 'Dropped bass.zip'),
    ]);
    expect(await screen.findByRole('heading', { name: 'Dropped bass' })).toBeInTheDocument();
  });

  it('installs a zip dropped on a curated row as that pack', async () => {
    const bytes = await curatedZip(GROWLY);
    setup();
    dropOn(row(GROWLY.name), [new File([bytes as BlobPart], 'whatever.zip')]);
    const installed = await screen.findByLabelText('Installed packs');
    await waitFor(() => {
      expect(within(installed).getByRole('heading', { name: GROWLY.name })).toBeInTheDocument();
    });
  });

  it('asks for one zip or folder when the drop is something else', async () => {
    const { view } = setup();
    dropOn(view.container.firstElementChild as HTMLElement, [new File(['x'], 'cover.png')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Drop a zip or a folder');
  });
});
