import { write } from '@reprise/formats';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { AppServicesProvider } from '@/app/services-context';
import { createTestServices } from '@/test/services';

import { firstStop } from './cursor';
import { editScore } from './test/scores';
import { useEditOverlays } from './use-edit-overlays';

async function setup() {
  const services = createTestServices();
  await services.document
    .getState()
    .openBytes('edit.reprise', (await write(editScore(), 'reprise')).bytes);
  const score = services.document.getState().score;
  if (!score) throw new Error('not open');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppServicesProvider services={services}>{children}</AppServicesProvider>
  );
  const hook = renderHook(() => useEditOverlays(), { wrapper });
  return { services, score, hook };
}

describe('useEditOverlays', () => {
  it('draws the caret only while editing, and the range in both modes', async () => {
    const { services, score, hook } = await setup();
    const cursor = firstStop(score, 0, 0);
    expect(hook.result.current).toEqual({});
    act(() => {
      services.selection.getState().setEdit({ cursor });
    });
    expect(hook.result.current.caret).toBeUndefined();

    act(() => {
      services.editing.getState().setEditing(true);
    });
    expect(hook.result.current.caret?.length).toBeGreaterThan(0);

    const focus = {
      track: cursor?.track ?? '',
      masterBar: score.masterBars[0]?.id ?? '',
      beat: score.tracks[0]?.bars[0]?.voices[0]?.beats[2]?.id,
    };
    act(() => {
      // Leaving edit mode clears a range; one set afterwards is drawn all the same.
      services.editing.getState().setEditing(false);
    });
    act(() => {
      services.selection
        .getState()
        .setEdit({ range: { kind: 'beats', anchor: { ...focus, beat: cursor?.beat }, focus } });
    });
    expect(hook.result.current.caret).toBeUndefined();
    expect(hook.result.current.range?.length).toBeGreaterThan(0);
  });

  it('keeps the same boxes while nothing it reads changes', async () => {
    const { services, score, hook } = await setup();
    act(() => {
      services.editing.getState().setEditing(true);
      services.selection.getState().setEdit({ cursor: firstStop(score, 0, 0) });
    });
    const before = hook.result.current;
    act(() => {
      services.selection.getState().select({});
    });
    expect(hook.result.current).toBe(before);
  });

  it('keeps the range boxes through a cursor move and the caret through a range change', async () => {
    const { services, score, hook } = await setup();
    const first = firstStop(score, 0, 0);
    const end = {
      track: first?.track ?? '',
      masterBar: score.masterBars[0]?.id ?? '',
      beat: undefined,
    };
    act(() => {
      services.editing.getState().setEditing(true);
      services.selection
        .getState()
        .setEdit({ cursor: first, range: { kind: 'bars', anchor: end, focus: end } });
    });
    const { caret, range } = hook.result.current;
    act(() => {
      services.selection.getState().setEdit({ cursor: firstStop(score, 0, 1) });
    });
    expect(hook.result.current.range).toBe(range);
    expect(hook.result.current.caret).not.toBe(caret);
    const moved = hook.result.current.caret;
    act(() => {
      services.selection.getState().setEdit({
        range: {
          kind: 'bars',
          anchor: end,
          focus: { ...end, masterBar: score.masterBars[1]?.id ?? '' },
        },
      });
    });
    expect(hook.result.current.caret).toBe(moved);
    expect(hook.result.current.range).not.toBe(range);
  });
});
