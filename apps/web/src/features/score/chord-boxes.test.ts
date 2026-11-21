import { layout } from '@reprise/layout';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { chordBoxes } from './chord-boxes';
import { uniformNotation } from './view-options';

const own = { baseFret: 1, frets: [0, 1, 2, 2, 0, null] };

function built() {
  const b = score().track('guitar');
  b.bar()
    .beat('4', [note(1, 0)], { chord: { name: 'Am', diagram: own } })
    .beat('4', [note(1, 0)], { chord: { name: 'G' } })
    .beat('4', [note(1, 0)], { chord: { name: 'Am', diagram: own } })
    .beat('4', [note(1, 0)]);
  return b.build({ ids: 'sequential' });
}

describe('chordBoxes', () => {
  const s = built();
  const beats = s.tracks[0]?.bars[0]?.voices[0]?.beats ?? [];
  const laid = layout(s, {
    mode: 'paged',
    width: 800,
    zoom: 1,
    tracks: 'all',
    notation: uniformNotation(s, 'tab'),
  });

  it('boxes the name and the diagram of each beat asked for', () => {
    const [am, g, , none] = beats;
    const found = chordBoxes(laid, new Set([am?.id ?? '', g?.id ?? '', none?.id ?? '']));
    const withDiagram = found.get(am?.id ?? '');
    const nameOnly = found.get(g?.id ?? '');
    expect(withDiagram).toHaveLength(1);
    expect(nameOnly).toHaveLength(1);
    // The diagram stands under the name, so its beat's box is taller than a bare name's.
    expect((withDiagram?.[0]?.box.height ?? 0) > (nameOnly?.[0]?.box.height ?? 0)).toBe(true);
    // A beat with no chord has nothing to box.
    expect(found.has(none?.id ?? '')).toBe(false);
  });

  it('finds nothing for an empty set or a beat that is not laid out', () => {
    expect(chordBoxes(laid, new Set()).size).toBe(0);
    expect(chordBoxes(laid, new Set(['nope'])).size).toBe(0);
  });

  it('puts both occurrences of a chord at different x', () => {
    const [first, , third] = beats;
    const found = chordBoxes(laid, new Set([first?.id ?? '', third?.id ?? '']));
    expect(found.get(first?.id ?? '')?.[0]?.box.x).toBeLessThan(
      found.get(third?.id ?? '')?.[0]?.box.x ?? 0,
    );
  });
});
