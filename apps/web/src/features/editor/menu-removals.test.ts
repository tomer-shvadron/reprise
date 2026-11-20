import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { createTestServices } from '@/test/services';

function setup() {
  const services = createTestServices();
  const builder = score().track('guitar');
  builder.bar();
  builder.beat('4', [note(1, 0)], { chord: { name: 'Am' } });
  builder.bar();
  builder.section('Verse');
  builder.beat('4', [note(1, 2)], { chord: { name: 'C' } });
  const built = builder.build({ ids: 'sequential' });
  services.document.setState({ score: built });
  services.editing.getState().setEditing(true);
  const registry = createAppRegistry(services);
  const run = (id: string) => {
    void registry.get(id)?.run();
  };
  return { services, built, registry, run };
}

describe('the removal commands of the edit-mode menus', () => {
  it('"Remove chord name" clears the right-clicked chord, in one undo step', () => {
    const { services, built, registry, run } = setup();
    const beat = built.tracks[0]?.bars[1]?.voices[0]?.beats[0];
    const track = built.tracks[0];
    const masterBar = built.masterBars[1];
    if (!beat || !track || !masterBar) throw new Error('short song');
    services.menuTarget
      .getState()
      .set({ kind: 'chord', beat: beat.id, track: track.id, masterBar: masterBar.id });
    expect(registry.get('editor.removeChordName')?.enabled?.()).toBe(true);
    run('editor.removeChordName');
    const after = services.document.getState().score?.tracks[0]?.bars;
    expect(after?.[1]?.voices[0]?.beats[0]?.chord).toBeUndefined();
    expect(after?.[0]?.voices[0]?.beats[0]?.chord?.name).toBe('Am');
    expect(services.document.getState().undoLabel).toBe('Chord name');
  });

  it('"Remove section" clears the right-clicked marker, and is disabled on a bar without one', () => {
    const { services, built, registry, run } = setup();
    const [first, second] = built.masterBars;
    if (!first || !second) throw new Error('short song');
    services.menuTarget.getState().set({ kind: 'section', masterBar: first.id });
    expect(registry.get('editor.removeSection')?.enabled?.()).toBe(false);
    services.menuTarget.getState().set({ kind: 'section', masterBar: second.id });
    expect(registry.get('editor.removeSection')?.enabled?.()).toBe(true);
    run('editor.removeSection');
    expect(services.document.getState().score?.masterBars[1]?.section).toBeUndefined();
  });

  it('do nothing outside edit mode', () => {
    const { services, built, registry } = setup();
    const second = built.masterBars[1];
    if (!second) throw new Error('short song');
    services.editing.getState().setEditing(false);
    services.menuTarget.getState().set({ kind: 'section', masterBar: second.id });
    expect(registry.get('editor.removeSection')?.enabled?.()).toBe(false);
  });
});
