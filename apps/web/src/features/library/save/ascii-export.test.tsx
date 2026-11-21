import { midi, note, score, type ScoreBuilder } from '@reprise/model/testing';
import { newId, type Score } from '@reprise/model';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { createMemoryStorage } from '@/test/memory-storage';
import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { openLibraryDb } from '../db/schema';
import { createLibrary, provideLibrary, type Library } from '../library';
import { uniqueDbName } from '../test-support';
import { asciiScopeOf } from './ascii-scope';
import { AsciiExportDialog } from './ascii-export-dialog';

const libraries: Library[] = [];
afterEach(async () => {
  Reflect.deleteProperty(navigator, 'clipboard');
  for (const library of libraries.splice(0)) await library.dispose();
});

function bars(builder: ScoreBuilder, count: number) {
  for (let bar = 0; bar < count; bar++) {
    builder.bar();
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, bar + beat)]);
  }
}

/** Two guitars and drums, three bars each. */
function song(): Score {
  const builder = score().title('Demo: song').track('guitar', { name: 'Lead' });
  bars(builder, 3);
  builder.track('guitar', { name: 'Rhythm' });
  bars(builder, 3);
  builder.track('drums', { name: 'Kit' });
  for (let bar = 0; bar < 3; bar++) {
    builder.bar();
    builder.beat('4', [midi(36)]);
  }
  return builder.build();
}

function setup(options: { saveFile?: () => Promise<string | undefined> } = {}) {
  const storage = createMemoryStorage();
  const saveFile = vi.fn<(name: string, bytes: Uint8Array) => Promise<string | undefined>>(
    options.saveFile ?? (() => Promise.resolve('/m/out.txt')),
  );
  const services = createTestServices({
    platform: fakePlatform({ ...storage.calls, saveFile }),
  });
  mirrorAudio(services);
  const library = createLibrary(services, { db: openLibraryDb(uniqueDbName()) });
  libraries.push(library);
  provideLibrary(services, library);
  const built = song();
  services.document.setState({ score: built });
  services.selection.getState().reset(built.tracks[0]?.id);
  const ids = built.masterBars.map((bar) => bar.id);
  return { services, library, saveFile, built, ids, user: userEvent.setup() };
}

const notice = (library: Library) => library.store.getState().notice;

describe('asciiScopeOf', () => {
  it('takes the range tracks in score order and its bars, whichever way it was dragged', () => {
    const { services, built, ids } = setup();
    const [lead, rhythm] = built.tracks;
    if (!lead || !rhythm) throw new Error('fixture');
    services.selection.setState({
      range: {
        kind: 'bars',
        anchor: { track: rhythm.id, masterBar: ids[2] ?? '', beat: undefined },
        focus: { track: lead.id, masterBar: ids[1] ?? '', beat: undefined },
      },
    });
    expect(
      asciiScopeOf(
        built,
        services.selection.getState(),
        undefined,
        services.document.getState().view,
      ),
    ).toEqual({
      tracks: [lead.id, rhythm.id],
      bars: { start: 1, end: 3 },
    });
  });

  it('falls back to the current track for a play-mode bar selection, and takes a bar target alone', () => {
    const { services, built, ids } = setup();
    services.selection.getState().selectBars({ startBar: ids[0] ?? '', endBar: ids[1] ?? '' });
    expect(
      asciiScopeOf(
        built,
        services.selection.getState(),
        undefined,
        services.document.getState().view,
      ),
    ).toEqual({
      tracks: [built.tracks[0]?.id],
      bars: { start: 0, end: 2 },
    });
    expect(
      asciiScopeOf(
        built,
        services.selection.getState(),
        { kind: 'bar', masterBar: ids[2] ?? '', track: built.tracks[1]?.id },
        services.document.getState().view,
      ),
    ).toEqual({ tracks: [built.tracks[1]?.id], bars: { start: 2, end: 3 } });
  });

  it('leaves out a hidden track inside the range, as the editor range does', () => {
    const { services, built, ids } = setup();
    const [lead, rhythm, kit] = built.tracks;
    if (!lead || !rhythm || !kit) throw new Error('fixture');
    services.document.getState().setVisibleTracks([lead.id, kit.id]);
    services.selection.setState({
      range: {
        kind: 'bars',
        anchor: { track: lead.id, masterBar: ids[0] ?? '', beat: undefined },
        focus: { track: kit.id, masterBar: ids[0] ?? '', beat: undefined },
      },
    });
    expect(
      asciiScopeOf(
        built,
        services.selection.getState(),
        undefined,
        services.document.getState().view,
      )?.tracks,
    ).toEqual([lead.id, kit.id]);
  });

  it('has nothing to take without a selection', () => {
    const { services, built } = setup();
    expect(
      asciiScopeOf(
        built,
        services.selection.getState(),
        undefined,
        services.document.getState().view,
      ),
    ).toBeUndefined();
  });
});

describe('Export as ASCII tab', () => {
  it('opens a dialog with the current track ticked and the drum track greyed out with the reason', async () => {
    const { services, library } = setup();
    renderWithServices(<AsciiExportDialog />, services);
    act(() => {
      library.asciiExport.open();
    });
    const dialog = await screen.findByRole('dialog', { name: 'Export as ASCII tab' });
    expect(within(dialog).getByRole('checkbox', { name: 'Lead' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Rhythm' })).not.toBeChecked();
    const kit = within(dialog).getByRole('checkbox', {
      name: /Kit/,
    });
    expect(kit).toBeDisabled();
    expect(within(dialog).getByText(/No strings: ASCII tab needs a fretted track/)).toBeVisible();
    expect(within(dialog).getByRole('radio', { name: 'Whole song' })).toBeChecked();
    expect(within(dialog).getByRole('spinbutton', { name: 'Line width' })).toHaveValue(80);
    expect(within(dialog).queryByRole('radio', { name: /Selected bar/ })).toBeNull();
  });

  it('defaults to the selected bars when there are some', async () => {
    const { services, library, ids } = setup();
    services.selection.getState().selectBars({ startBar: ids[1] ?? '', endBar: ids[2] ?? '' });
    renderWithServices(<AsciiExportDialog />, services);
    act(() => {
      library.asciiExport.open();
    });
    expect(await screen.findByRole('radio', { name: 'Selected bars 2–3' })).toBeChecked();
  });

  it('writes a .txt of the ticked tracks through the save dialog, and says nothing was lost', async () => {
    const { services, library, saveFile, user } = setup();
    renderWithServices(<AsciiExportDialog />, services);
    const before = services.document.getState();
    act(() => {
      library.asciiExport.open();
    });
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox', { name: 'Rhythm' }));
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledTimes(1);
    });
    const [name, bytes, filters] = saveFile.mock.calls[0] as unknown as [
      string,
      Uint8Array,
      unknown,
    ];
    expect(name).toBe('Demo_ song.txt');
    expect(filters).toEqual([{ name: 'Text', extensions: ['txt'] }]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('Lead | Tuning');
    expect(text).toContain('Rhythm | Tuning');
    expect(text).not.toContain('Kit');
    await waitFor(() => {
      expect(notice(library)).toEqual({ kind: 'info', message: 'Exported Demo_ song.txt.' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // An export is not a save.
    const after = services.document.getState();
    expect(after.dirty).toBe(before.dirty);
    expect(after.songId).toBe(before.songId);
  });

  it('names the file after the track when one is written, and keeps only the selected bars on request', async () => {
    const { services, library, saveFile, ids, user } = setup();
    services.selection.getState().selectBars({ startBar: ids[1] ?? '', endBar: ids[1] ?? '' });
    renderWithServices(<AsciiExportDialog />, services);
    act(() => {
      library.asciiExport.open();
    });
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(saveFile).toHaveBeenCalled();
    });
    const [name, bytes] = saveFile.mock.calls[0] as unknown as [string, Uint8Array];
    expect(name).toBe('Demo_ song - Lead.txt');
    expect(new TextDecoder().decode(bytes)).toMatch(/^\s*2\b/mu);
  });

  it('reports what a track left out in the notice', async () => {
    const { services, library, saveFile } = setup();
    const built = services.document.getState().score;
    if (!built) throw new Error('fixture');
    const withTwoVoices = structuredClone(built);
    const first = withTwoVoices.tracks[0]?.bars[0];
    const voice = first?.voices[0];
    if (!first || !voice) throw new Error('fixture');
    first.voices[1] = { ...structuredClone(voice), id: newId() };
    services.document.setState({ score: withTwoVoices });
    renderWithServices(<AsciiExportDialog />, services);
    act(() => {
      library.asciiExport.open();
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(saveFile).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(notice(library)?.message).toBe(
        'Exported Demo_ song - Lead.txt. Notes in voices 2 to 4 were left out.',
      );
    });
  });

  it('disables Export for a width out of range, and with no track ticked', async () => {
    const { services, library, saveFile, user } = setup();
    renderWithServices(<AsciiExportDialog />, services);
    act(() => {
      library.asciiExport.open();
    });
    const dialog = await screen.findByRole('dialog');
    const exportButton = within(dialog).getByRole('button', { name: 'Export' });
    const width = within(dialog).getByRole('spinbutton', { name: 'Line width' });
    await user.clear(width);
    await user.type(width, '39');
    expect(exportButton).toBeDisabled();
    await user.clear(width);
    await user.type(width, '120');
    expect(exportButton).toBeEnabled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Lead' }));
    expect(exportButton).toBeDisabled();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('remembers the width for the session', async () => {
    const { services, library, user } = setup();
    renderWithServices(<AsciiExportDialog />, services);
    act(() => {
      library.asciiExport.open();
    });
    let dialog = await screen.findByRole('dialog');
    const width = within(dialog).getByRole('spinbutton', { name: 'Line width' });
    await user.clear(width);
    await user.type(width, '120');
    await user.click(within(dialog).getByRole('button', { name: 'Export' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    act(() => {
      library.asciiExport.open();
    });
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('spinbutton', { name: 'Line width' })).toHaveValue(120);
  });

  it('does nothing on Cancel, and never opens without a score', async () => {
    const { services, library, saveFile, user } = setup();
    renderWithServices(<AsciiExportDialog />, services);
    act(() => {
      library.asciiExport.open();
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    services.document.setState({ score: undefined });
    act(() => {
      library.asciiExport.open();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('says nothing when the save dialog is cancelled, and reports a failed write', async () => {
    const cancelled = setup({ saveFile: () => Promise.resolve(undefined) });
    cancelled.library.asciiExport.open();
    await cancelled.library.asciiExport.submit();
    expect(notice(cancelled.library)).toBeUndefined();

    const failed = setup({ saveFile: () => Promise.reject(new Error('disk full')) });
    failed.library.asciiExport.open();
    await failed.library.asciiExport.submit();
    expect(notice(failed.library)).toEqual({
      kind: 'error',
      message: 'Could not export Demo_ song - Lead.txt: disk full',
    });
  });

  it('refuses a score with only drums: the writer error stays in the dialog', async () => {
    const { services, library, saveFile } = setup();
    renderWithServices(<AsciiExportDialog />, services);
    const drums = score().title('Beat').track('drums', { name: 'Kit' });
    drums.bar().beat('4', [midi(36)]);
    const built = drums.build();
    services.document.setState({ score: built });
    act(() => {
      library.asciiExport.open();
    });
    await screen.findByRole('dialog');
    // The dialog never lets a drum track be ticked; the writer's own refusal is the backstop.
    act(() => {
      library.asciiExport.update({ tracks: built.tracks.map((track) => track.id) });
    });
    await act(async () => {
      await library.asciiExport.submit();
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kit has no strings: ASCII tab needs a fretted track',
    );
    expect(saveFile).not.toHaveBeenCalled();
  });
});

describe('Copy as ASCII tab', () => {
  const stubClipboard = (writeText: (text: string) => Promise<void>) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  };

  it("copies the range's tracks and bars, and tells how many bars", async () => {
    const { services, library, built, ids } = setup();
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    const [lead, rhythm] = built.tracks;
    services.selection.setState({
      range: {
        kind: 'bars',
        anchor: { track: lead?.id ?? '', masterBar: ids[0] ?? '', beat: undefined },
        focus: { track: rhythm?.id ?? '', masterBar: ids[1] ?? '', beat: undefined },
      },
    });
    await library.asciiExport.copy();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('Lead | Tuning');
    expect(written[0]).toContain('Rhythm | Tuning');
    expect(notice(library)).toEqual({ kind: 'info', message: 'Copied 2 bars as ASCII tab.' });
  });

  it('copies the current track for a play-mode bar selection', async () => {
    const { services, library, ids } = setup();
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    services.selection.getState().selectBars({ startBar: ids[2] ?? '', endBar: ids[2] ?? '' });
    await library.asciiExport.copy();
    expect(written[0]).toContain('Lead | Tuning');
    expect(written[0]).not.toContain('Rhythm');
    expect(notice(library)?.message).toBe('Copied 1 bar as ASCII tab.');
  });

  it('reads the menu target before its first await', async () => {
    const { services, library, built, ids } = setup();
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    services.menuTarget.getState().set({
      kind: 'bar',
      masterBar: ids[1] ?? '',
      track: built.tracks[1]?.id,
    });
    const done = library.asciiExport.copy();
    services.menuTarget.getState().clear();
    await done;
    expect(written[0]).toContain('Rhythm | Tuning');
    expect(written[0]).not.toContain('Lead');
  });

  it('says why when nothing is selected, and when the clipboard refuses', async () => {
    const { services, library, ids } = setup();
    await library.asciiExport.copy();
    expect(notice(library)).toEqual({
      kind: 'error',
      message: 'Select some bars to copy them as ASCII tab.',
    });
    stubClipboard(() => Promise.reject(new Error('denied')));
    services.selection.getState().selectBars({ startBar: ids[0] ?? '', endBar: ids[0] ?? '' });
    await library.asciiExport.copy();
    expect(notice(library)).toEqual({
      kind: 'error',
      message: 'Could not copy as ASCII tab: the clipboard refused the text (denied)',
    });
  });

  it('copies the fretted tracks of a range that reaches a drum track, and says so', async () => {
    const { services, library, built, ids } = setup();
    const written: string[] = [];
    stubClipboard((text) => {
      written.push(text);
      return Promise.resolve();
    });
    const [, rhythm, kit] = built.tracks;
    services.selection.setState({
      range: {
        kind: 'bars',
        anchor: { track: rhythm?.id ?? '', masterBar: ids[0] ?? '', beat: undefined },
        focus: { track: kit?.id ?? '', masterBar: ids[0] ?? '', beat: undefined },
      },
    });
    await library.asciiExport.copy();
    expect(written[0]).toContain('Rhythm | Tuning');
    expect(written[0]).not.toContain('Kit');
    expect(notice(library)).toEqual({
      kind: 'info',
      message:
        'Copied 1 bar as ASCII tab. Tracks without strings (drums and pitched tracks) were left out.',
    });
  });

  it('says why a drum track cannot be copied', async () => {
    const { services, library, built, ids } = setup();
    stubClipboard(() => Promise.resolve());
    services.selection.getState().setCurrentTrack(built.tracks[2]?.id);
    services.selection.getState().selectBars({ startBar: ids[0] ?? '', endBar: ids[0] ?? '' });
    await library.asciiExport.copy();
    expect(notice(library)).toEqual({
      kind: 'error',
      message: 'Could not copy as ASCII tab: Kit has no strings: ASCII tab needs a fretted track',
    });
  });
});
