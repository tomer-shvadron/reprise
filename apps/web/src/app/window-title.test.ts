import { setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createTestServices } from '@/test/services';

import { installWindowTitle, windowTitleOf } from './window-title';

describe('the window title', () => {
  it('names the document, marks it while modified, and is plain with nothing open', () => {
    const { document } = createTestServices();
    expect(windowTitleOf(document.getState())).toBe('Reprise');
    document.getState().newDocument(score().title('Riff').track('guitar').build());
    expect(windowTitleOf(document.getState())).toBe('Riff — Reprise');
    document
      .getState()
      .apply(
        setTrackProperties(
          { trackId: document.getState().score?.tracks[0]?.id ?? '' },
          { name: 'X' },
        ),
      );
    expect(windowTitleOf(document.getState())).toBe('● Riff — Reprise');
  });

  it('falls back to the file name without its extension, then to Untitled', () => {
    const base = { id: 'a', dirty: false } as const;
    const empty = score().title('  ').track('guitar').build();
    expect(
      windowTitleOf({
        ...base,
        score: empty,
        file: { name: 'solo.gp5', format: 'gp5', key: 'k', savedKeys: [] },
      }),
    ).toBe('solo — Reprise');
    expect(windowTitleOf({ ...base, score: empty, file: undefined })).toBe('Untitled — Reprise');
  });

  it('sets document.title and the macOS dot only when they change', () => {
    const { document } = createTestServices();
    const target = { title: '' };
    const setDocumentEdited = vi.fn();
    const stop = installWindowTitle(document, { setDocumentEdited }, target);
    expect(target.title).toBe('Reprise');
    expect(setDocumentEdited).toHaveBeenLastCalledWith(false);
    document.getState().newDocument(score().title('Riff').track('guitar').build());
    expect(target.title).toBe('Riff — Reprise');
    document
      .getState()
      .apply(
        setTrackProperties(
          { trackId: document.getState().score?.tracks[0]?.id ?? '' },
          { name: 'X' },
        ),
      );
    document
      .getState()
      .apply(
        setTrackProperties(
          { trackId: document.getState().score?.tracks[0]?.id ?? '' },
          { name: 'Y' },
        ),
      );
    expect(target.title).toBe('● Riff — Reprise');
    expect(setDocumentEdited.mock.calls).toEqual([[false], [true]]);
    document.getState().close();
    expect(target.title).toBe('Reprise');
    expect(setDocumentEdited).toHaveBeenLastCalledWith(false);
    stop();
  });
});
