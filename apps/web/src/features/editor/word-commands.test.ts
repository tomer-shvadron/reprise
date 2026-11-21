import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { createTestServices } from '@/test/services';

import { cursorAtPosition } from './cursor';
import { must } from './test/must';

function song(): Score {
  const built = score().track('guitar');
  built
    .bar()
    // x32010, the open C shape, with a diagram that the naming must keep.
    .beat('4', [note(5, 3), note(4, 2), note(3, 0), note(2, 1), note(1, 0)], {
      chord: { name: 'Cadd', diagram: { baseFret: 1, frets: [0, 1, 0, 2, 3, null] } },
    })
    .beat('4', [note(1, 0)]);
  return built.build({ ids: 'sequential' });
}

async function setup() {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  await services.document
    .getState()
    .openBytes('name.reprise', (await write(song(), 'reprise')).bytes);
  services.editing.getState().setEditing(true);
  const goTo = (stop: number) => {
    const current = must(services.document.getState().score);
    const cursor = cursorAtPosition(
      current,
      { track: 0, bar: 0, voice: 0, stop },
      { string: 1, staff: 'tab' },
    );
    services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
  };
  const beat = (index: number) =>
    must(services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats[index]);
  const run = () => void must(registry.get('editor.nameChordFromNotes')).run();
  return { services, registry, goTo, beat, run };
}

describe('editor.nameChordFromNotes', () => {
  it('is an unbound editing command with its title', async () => {
    const { registry } = await setup();
    expect(registry.get('editor.nameChordFromNotes')).toMatchObject({
      title: 'Name chord from notes',
      context: 'editing',
    });
    expect(registry.get('editor.nameChordFromNotes')?.shortcut).toBeUndefined();
  });

  it('writes the top name, keeps the diagram and undoes in one step', async () => {
    const t = await setup();
    t.goTo(0);
    t.run();
    expect(t.beat(0).chord?.name).toBe('C');
    expect(t.beat(0).chord?.diagram?.frets).toEqual([0, 1, 0, 2, 3, null]);
    expect(t.services.document.getState().historyLabels.undo[0]).toBe('Chord name');
    t.services.document.getState().undo();
    expect(t.beat(0).chord?.name).toBe('Cadd');
  });

  it('refuses on the status line when the notes name nothing', async () => {
    const t = await setup();
    t.goTo(1);
    const before = t.services.document.getState().score;
    t.run();
    expect(t.services.entry.getState().message).toBe("These notes don't name a chord");
    expect(t.services.document.getState().score).toBe(before);
  });
});
