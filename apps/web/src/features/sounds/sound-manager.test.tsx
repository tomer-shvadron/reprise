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
import type { InstalledPack, PackManifest } from './manifest';
import { createAppRegistry } from '@/app/app-registry';
import { DropZone } from '@/app/drop-zone';

import { fakeDir, fakeFile } from './test/fake-entries';
import { packContents, zipOf } from './test/pack-fixtures';
import { SoundManager } from './sound-manager';

const [first, second] = CURATED_PACKS;
if (!first || !second) throw new Error('the curated list is empty');
const SWAG: PackManifest = first;
const GROWLY: PackManifest = second;

/** A zip holding the pack a curated manifest promises: each entry an SFZ over one shared sample. */
async function curatedZip(manifest = SWAG) {
  const base = packContents();
  const contents = new Map<string, Uint8Array>();
  const wav = base.get('samples/a.wav');
  if (!wav) throw new Error('no sample');
  contents.set('s/a.wav', wav);
  for (const instrument of manifest.instruments) {
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

const screenRoot = (container: HTMLElement): HTMLElement => {
  const element = container.firstElementChild;
  if (!(element instanceof HTMLElement)) throw new Error('no screen');
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
    expect(
      within(item).getByRole('link', { name: `Open download page for ${SWAG.name}` }),
    ).toHaveAttribute('href', SWAG.sourceUrl);
    expect(
      within(item).getByRole('button', { name: `Choose zip for ${SWAG.name}` }),
    ).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: `Download ${SWAG.name}` })).toBeNull();
  });

  it('offers Download on a platform that can download', () => {
    setup({ download: vi.fn() });
    const item = row(SWAG.name);
    expect(within(item).getByRole('button', { name: `Download ${SWAG.name}` })).toBeInTheDocument();
    expect(
      within(item).queryByRole('link', { name: `Open download page for ${SWAG.name}` }),
    ).toBeNull();
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

    await user.click(within(row('My bass')).getByRole('button', { name: 'Rename My bass' }));
    const input = screen.getByRole('textbox', { name: 'Name of My bass' });
    await user.clear(input);
    await user.type(input, 'Fretless{Enter}');
    expect(await screen.findByRole('heading', { name: 'Fretless' })).toBeInTheDocument();
    expect(name).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Remove Fretless' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No song is open/)).toBeInTheDocument();
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
    expect(within(row(SWAG.name)).getByText(/Used by 1 track in this song/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Remove ${SWAG.name}` }));
    expect(
      within(await screen.findByRole('dialog')).getByText(
        /1 track of the open song uses this pack/,
      ),
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
    await user.click(within(alert).getByRole('button', { name: /Dismiss/ }));
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
    const bar = await screen.findByRole('progressbar', { name: `Installing ${SWAG.name}` });
    expect(screen.getByText('Downloading: 50 MB of 144 MB')).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', String(50 * 1024 * 1024));
    expect(bar).toHaveAttribute('aria-valuemax', String(144 * 1024 * 1024));
    expect(download).toHaveBeenCalledWith(
      expect.objectContaining({ url: SWAG.download?.url, sha256: SWAG.download?.sha256 }),
    );
    // One install at a time: the other pack's buttons are disabled meanwhile.
    expect(
      within(row(GROWLY.name)).getByRole('button', { name: `Download ${GROWLY.name}` }),
    ).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
    // The Cancel button went with the progress block; focus lands on the button that starts installs.
    expect(screen.getByRole('button', { name: 'Install from zip…' })).toHaveFocus();
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
  const dropOn = (target: Element, files: File[]) => {
    fireEvent.drop(target, { dataTransfer: { types: ['Files'], items: [], files } });
  };

  it('installs a zip dropped on the screen as a custom pack', async () => {
    const bytes = await zipOf(packContents(), 'Pack/');
    const { view } = setup();
    dropOn(screenRoot(view.container), [new File([bytes.slice()], 'Dropped bass.zip')]);
    expect(await screen.findByRole('heading', { name: 'Dropped bass' })).toBeInTheDocument();
  });

  it('installs a zip dropped on a curated row as that pack', async () => {
    const bytes = await curatedZip(GROWLY);
    setup();
    dropOn(row(GROWLY.name), [new File([bytes.slice()], 'whatever.zip')]);
    const installed = await screen.findByLabelText('Installed packs');
    await waitFor(() => {
      expect(within(installed).getByRole('heading', { name: GROWLY.name })).toBeInTheDocument();
    });
  });

  it('asks for one zip or folder when the drop is something else', async () => {
    const { view } = setup();
    dropOn(screenRoot(view.container), [new File(['x'], 'cover.png')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Drop a zip or a folder');
  });
});

const installedSection = () => screen.getByLabelText('Installed packs');

async function installCurated(
  user: ReturnType<typeof userEvent.setup>,
  openFiles: ReturnType<typeof setup>['openFiles'],
  pack: PackManifest = SWAG,
) {
  openFiles.mockResolvedValueOnce([picked('pack.zip', await curatedZip(pack))]);
  await user.click(screen.getByRole('button', { name: `Choose zip for ${pack.name}` }));
  await waitFor(() => {
    expect(
      within(installedSection()).getByRole('heading', { name: pack.name }),
    ).toBeInTheDocument();
  });
}

describe('SoundManager: drops on rows', () => {
  const drop = (target: Element, files: File[]) => {
    fireEvent.drop(target, { dataTransfer: { types: ['Files'], items: [], files } });
  };

  it('does not leave the window drop overlay behind after a drop on a row', async () => {
    const bytes = await curatedZip(GROWLY);
    const services = createTestServices({
      platform: fakePlatform({ ...createMemoryStorage().calls }),
    });
    renderWithServices(
      <>
        <DropZone />
        <SoundManager />
      </>,
      services,
    );
    act(() => {
      services.ui.getState().showSheet('sounds');
    });
    const file = new File([bytes.slice()], 'x.zip');
    const transfer = { types: ['Files'], items: [], files: [file] };
    const target = row(GROWLY.name);
    act(() => {
      fireEvent.dragEnter(target, { dataTransfer: transfer });
    });
    drop(target, [file]);
    await waitFor(() => {
      expect(
        within(installedSection()).getByRole('heading', { name: GROWLY.name }),
      ).toBeInTheDocument();
    });
    act(() => {
      services.ui.getState().closeSheet();
    });
    expect(screen.queryByText('Drop to open')).toBeNull();
  });

  it('refuses a zip that is not the pack on the row, and leaves no custom pack behind', async () => {
    const wrong = await zipOf(packContents(), 'Pack/');
    setup();
    drop(row(GROWLY.name), [new File([wrong.slice()], 'other.zip')]);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`This is not the ${GROWLY.name} archive`);
    expect(screen.getByText('No sound packs are installed.')).toBeInTheDocument();
  });

  it('leaves no custom pack behind after a good drop on a row', async () => {
    setup();
    drop(row(GROWLY.name), [new File([(await curatedZip(GROWLY)).slice()], 'g.zip')]);
    await waitFor(() => {
      expect(
        within(installedSection()).getByRole('heading', { name: GROWLY.name }),
      ).toBeInTheDocument();
    });
    expect(within(installedSection()).getAllByRole('heading', { level: 4 })).toHaveLength(1);
  });

  it('takes a zip dropped on an installed curated row as an update of that pack', async () => {
    const { user, openFiles } = setup();
    await installCurated(user, openFiles);
    drop(row(SWAG.name), [new File([(await curatedZip()).slice()], 'again.zip')]);
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
    expect(document.querySelectorAll(`[data-pack-id="${SWAG.id}"]`)).toHaveLength(1);
    expect(within(installedSection()).getAllByRole('heading', { level: 4 })).toHaveLength(1);
    // And a wrong zip is refused with the old pack kept.
    drop(row(SWAG.name), [new File([(await zipOf(packContents(), 'P/')).slice()], 'bad.zip')]);
    expect(await screen.findByRole('alert')).toHaveTextContent('This is not the');
    expect(
      within(installedSection()).getByRole('heading', { name: SWAG.name }),
    ).toBeInTheDocument();
  });

  it('installs a dropped folder as a custom pack, told apart from a file through the items', async () => {
    const { view } = setup();
    const contents = packContents();
    const flat = fakeDir('Dropped folder', [
      fakeFile('one.sfz', '<region> sample=a.wav lokey=0 hikey=127 pitch_keycenter=60\n'),
      fakeFile('a.wav', contents.get('samples/a.wav') ?? ''),
    ]);
    fireEvent.drop(screenRoot(view.container), {
      dataTransfer: {
        types: ['Files'],
        files: [],
        items: [{ kind: 'file', webkitGetAsEntry: () => flat, getAsFile: () => null }],
      },
    });
    expect(await screen.findByRole('heading', { name: 'Dropped folder' })).toBeInTheDocument();
  });

  it('ignores a drop while the Remove confirm is open', async () => {
    const bytes = await zipOf(packContents(), 'Pack/');
    const { user, openFiles, view } = setup();
    openFiles.mockResolvedValueOnce([picked('My bass.zip', bytes)]);
    await user.click(screen.getByRole('button', { name: 'Install from zip…' }));
    await screen.findByRole('heading', { name: 'My bass' });
    await user.click(screen.getByRole('button', { name: 'Remove My bass' }));
    const dialog = await screen.findByRole('dialog');
    drop(dialog, [new File([bytes.slice()], 'Other.zip')]);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(installedSection()).getAllByRole('heading', { level: 4 })).toHaveLength(1);
    expect(screenRoot(view.container)).toBeInTheDocument();
  });

  it('shows a picker failure instead of dropping it', async () => {
    const { user, openFiles } = setup();
    openFiles.mockRejectedValueOnce(new Error('the picker crashed'));
    await user.click(screen.getByRole('button', { name: 'Install from zip…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('the picker crashed');
  });
});

describe('SoundManager: outdated and used packs', () => {
  it('offers the download page and a zip for an outdated curated pack without direct download', async () => {
    const { user, openFiles, storage, services } = setup();
    await installCurated(user, openFiles);
    const path = `data/sounds/${SWAG.id}/pack.json`;
    const stored: unknown = JSON.parse(new TextDecoder().decode(storage.bytes(path)));
    if (typeof stored !== 'object' || stored === null) throw new Error('bad pack.json');
    await services.platform.writeFile(
      path,
      new TextEncoder().encode(JSON.stringify({ ...stored, version: '0.9' })),
    );
    await act(async () => {
      await services.sounds.scan();
    });
    const item = row(SWAG.name);
    expect(within(item).getByText('Update available')).toBeInTheDocument();
    expect(
      within(item).getByRole('link', { name: `Open download page for ${SWAG.name}` }),
    ).toHaveAttribute('href', SWAG.sourceUrl);
    expect(
      within(item).getByRole('button', { name: `Choose zip to update ${SWAG.name}` }),
    ).toBeInTheDocument();
    expect(within(item).queryByRole('button', { name: `Update ${SWAG.name}` })).toBeNull();
  });

  it('hides the used-by count with no song open, and words the confirm for it', async () => {
    const { user, openFiles } = setup();
    await installCurated(user, openFiles);
    expect(within(row(SWAG.name)).queryByText(/Used by/)).toBeNull();
    await user.click(screen.getByRole('button', { name: `Remove ${SWAG.name}` }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('No song is open');
  });

  it('says tracks in the plural', async () => {
    const { services, user, openFiles } = setup();
    const song = score().track('bass', { name: 'A' }).track('bass', { name: 'B' }).build();
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    await installCurated(user, openFiles);
    for (const track of services.document.getState().score?.tracks ?? []) {
      act(() => {
        services.document
          .getState()
          .apply(setTrackProperties({ trackId: track.id }, { sound: { packId: SWAG.id } }));
      });
    }
    expect(within(row(SWAG.name)).getByText(/Used by 2 tracks in this song/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Remove ${SWAG.name}` }));
    expect(await screen.findByRole('dialog')).toHaveTextContent(
      '2 tracks of the open song use this pack',
    );
  });

  it('counts a track that plays the pack as its family default', async () => {
    const { services, user, openFiles } = setup();
    const song = score().track('bass', { name: 'A' }).track('bass', { name: 'B' }).build();
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    await installCurated(user, openFiles);
    const [first, other] = services.document.getState().score?.tracks ?? [];
    if (!first || !other) throw new Error('two tracks expected');
    act(() => {
      services.playback.setState({
        trackSounds: {
          [first.id]: { tier: 'hq', packId: SWAG.id, source: 'default' },
          [other.id]: { tier: 'gm' },
        },
      });
    });
    expect(within(row(SWAG.name)).getByText(/Used by 1 track in this song/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Remove ${SWAG.name}` }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('1 track of the open song uses');
  });
});

describe('SoundManager: keyboard, focus and announcements', () => {
  it('puts focus on the Installed heading after Remove and on the Remove button after Cancel', async () => {
    const { user, openFiles } = setup();
    await installCurated(user, openFiles);
    await user.click(screen.getByRole('button', { name: `Remove ${SWAG.name}` }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: `Remove ${SWAG.name}` })).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: `Remove ${SWAG.name}` }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: SWAG.name, level: 4 })).toBeNull();
    });
    expect(screen.getByRole('heading', { name: 'Installed' })).toHaveFocus();
  });

  it('puts focus on the screen heading after Dismiss and on the Installed heading after removing a damaged folder', async () => {
    const storage = createMemoryStorage();
    const openFiles = vi.fn<Platform['openFiles']>(() => Promise.resolve([]));
    const platform = fakePlatform({ ...storage.calls, openFiles });
    await platform.writeFile('data/sounds/Broken000001/files/a.sfz', new Uint8Array(1));
    const services = createTestServices({ platform });
    await act(async () => {
      await services.sounds.scan();
    });
    renderWithServices(<SoundManager />, services);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove damaged folder Broken000001' }));
    await waitFor(() => {
      expect(screen.queryByText(/Damaged:/)).toBeNull();
    });
    expect(screen.getByRole('heading', { name: 'Installed' })).toHaveFocus();

    const wrong = await zipOf(packContents(), 'P/');
    openFiles.mockResolvedValueOnce([picked('w.zip', wrong)]);
    await user.click(screen.getByRole('button', { name: `Choose zip for ${SWAG.name}` }));
    await user.click(await screen.findByRole('button', { name: /Dismiss/ }));
    expect(screen.getByRole('heading', { name: 'Sounds' })).toHaveFocus();
  });

  it('cancels a rename with Escape without closing the screen, and refuses an empty name', async () => {
    const outer = vi.fn();
    const bytes = await zipOf(packContents(), 'Pack/');
    const storage = createMemoryStorage();
    const openFiles = vi.fn<Platform['openFiles']>(() =>
      Promise.resolve([picked('My bass.zip', bytes)]),
    );
    const services = createTestServices({
      platform: fakePlatform({ ...storage.calls, openFiles }),
    });
    renderWithServices(
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') outer();
        }}
      >
        <SoundManager />
      </div>,
      services,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Install from zip…' }));
    await screen.findByRole('heading', { name: 'My bass' });
    await user.click(screen.getByRole('button', { name: 'Rename My bass' }));
    const input = screen.getByRole('textbox', { name: 'Name of My bass' });
    await user.clear(input);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(input, 'Typed name{Escape}');
    expect(outer).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('heading', { name: 'My bass' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename My bass' })).toHaveFocus();
    // With focus out of the form, Escape reaches the screen.
    await user.keyboard('{Escape}');
    expect(outer).toHaveBeenCalledOnce();
  });

  it('mounts an empty live region and announces the phase and quarters, not every tick', async () => {
    let report: ((loaded: number, total?: number) => void) | undefined;
    const download = vi.fn(
      ({ onProgress }: Parameters<NonNullable<Platform['download']>>[0]) =>
        new Promise<{ size: number }>(() => {
          report = onProgress;
        }),
    );
    const { user } = setup({ download });
    const region = screen.getAllByRole('status').find((el) => el.classList.contains('sr-only'));
    if (!region) throw new Error('no live region');
    expect(region).toBeEmptyDOMElement();
    await user.click(screen.getByRole('button', { name: `Download ${SWAG.name}` }));
    await waitFor(() => {
      expect(region).toHaveTextContent(`Installing ${SWAG.name}: Downloading`);
    });
    const seen: string[] = [];
    const watcher = new MutationObserver(() => seen.push(region.textContent));
    watcher.observe(region, { childList: true, characterData: true, subtree: true });
    for (let loaded = 1; loaded <= 24; loaded += 1) {
      act(() => report?.(loaded, 100));
    }
    watcher.disconnect();
    // Twenty-four ticks, no announcement: the next one is the 25% mark.
    expect(seen).toEqual([]);
    act(() => report?.(25, 100));
    await waitFor(() => {
      expect(region).toHaveTextContent('Downloading, 25%');
    });
    act(() => report?.(50, 100));
    await waitFor(() => {
      expect(region).toHaveTextContent('Downloading, 50%');
    });
  });
});

describe('the pack row requests', () => {
  const custom: InstalledPack = {
    ...SWAG,
    id: 'custompack01',
    name: 'Mine',
    curated: false,
    source: 'folder',
    installedAt: '2026-01-01T00:00:00.000Z',
    files: [],
    directDownload: false,
  };

  it('opens the rename form on the current name, the Remove confirm, and clears both on unmount', () => {
    const { services, view } = setup();
    act(() => {
      services.sounds.api.setState({ packs: [custom], renamingId: custom.id });
    });
    const field = screen.getByRole('textbox', { name: 'Name of Mine' });
    expect(field).toHaveValue('Mine');
    expect(field).toHaveFocus();

    act(() => {
      services.sounds.api.setState({ renamingId: undefined, removingId: custom.id });
    });
    expect(screen.getByRole('dialog', { name: /Remove .Mine./ })).toBeInTheDocument();

    act(() => {
      services.sounds.api.setState({ renamingId: custom.id });
    });
    view.unmount();
    expect(services.sounds.getState().removingId).toBeUndefined();
    expect(services.sounds.getState().renamingId).toBeUndefined();
  });

  it('runs sounds.removePack as the confirm for an installed pack and directly for a damaged one', async () => {
    const { services } = setup();
    const registry = createAppRegistry(services);
    const removeDamaged = vi.spyOn(services.sounds, 'removeDamaged').mockResolvedValue(true);
    act(() => {
      services.sounds.api.setState({
        packs: [custom],
        damaged: [{ folder: 'broken', reason: 'x' }],
      });
      services.menuTarget.getState().set({ kind: 'soundPack', id: custom.id, state: 'installed' });
    });
    act(() => {
      void registry.get('sounds.removePack')?.run();
    });
    expect(await screen.findByRole('dialog', { name: /Remove .Mine./ })).toBeInTheDocument();
    expect(removeDamaged).not.toHaveBeenCalled();

    act(() => {
      services.sounds.api.setState({ removingId: undefined });
      services.menuTarget.getState().set({ kind: 'soundPack', id: 'broken', state: 'damaged' });
    });
    act(() => {
      void registry.get('sounds.removePack')?.run();
    });
    expect(removeDamaged).toHaveBeenCalledWith('broken');
  });

  it('disables Remove folder while an install runs', () => {
    const { services } = setup();
    act(() => {
      services.sounds.api.setState({
        damaged: [{ folder: 'broken', reason: 'x' }],
        job: { packId: 'p', name: 'P', phase: 'downloading', done: 0, total: undefined },
      });
    });
    expect(screen.getByRole('button', { name: 'Remove damaged folder broken' })).toBeDisabled();
  });
});
