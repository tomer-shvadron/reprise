import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { rankSections, sectionsOf } from './sections';

function song(markers: Record<number, [string, string?]>, bars = 12) {
  const builder = score().track('guitar');
  for (let i = 0; i < bars; i += 1) {
    builder.bar();
    const marker = markers[i];
    if (marker) builder.section(marker[0], marker[1] === undefined ? {} : { letter: marker[1] });
  }
  return builder.build();
}

describe('sectionsOf', () => {
  it('runs each section to the bar before the next, the last to the end', () => {
    const sections = sectionsOf(song({ 2: ['Intro'], 6: ['Verse'], 9: ['Outro'] }));
    expect(sections.map((s) => [s.label, s.startBar, s.endBar])).toEqual([
      ['Intro', 3, 6],
      ['Verse', 7, 9],
      ['Outro', 10, 12],
    ]);
  });

  it('numbers duplicate names in score order', () => {
    const sections = sectionsOf(
      song({ 0: ['Chorus'], 2: ['chorus '], 4: ['Verse 1'], 6: ['Verse 1'], 8: ['Bridge'] }),
    );
    expect(sections.map((s) => s.label)).toEqual([
      'Chorus 1',
      'chorus 2',
      'Verse 1 (1)',
      'Verse 1 (2)',
      'Bridge',
    ]);
  });

  it('never gives an ordinal that another section already has as its name', () => {
    const sections = sectionsOf(song({ 0: ['Chorus'], 2: ['Chorus'], 4: ['Chorus 2'] }));
    const labels = sections.map((s) => s.label);
    expect(labels).toEqual(['Chorus 1', 'Chorus 3', 'Chorus 2']);
    expect(new Set(labels).size).toBe(3);
  });

  it('names a blank marker by its letter, else its bar', () => {
    const sections = sectionsOf(song({ 0: ['', 'A'], 4: ['  '] }));
    expect(sections.map((s) => s.label)).toEqual(['Section A', 'Section at bar 5']);
  });

  it('caches per score and rebuilds for a new one', () => {
    const built = song({ 0: ['A'] });
    expect(sectionsOf(built)).toBe(sectionsOf(built));
    expect(sectionsOf({ ...built })).not.toBe(sectionsOf(built));
  });

  it('has none without markers', () => {
    expect(sectionsOf(song({}))).toEqual([]);
  });
});

describe('rankSections', () => {
  const sections = sectionsOf(
    song({ 0: ['Intro', 'A'], 2: ['Chorus', 'B'], 4: ['Verse'], 6: ['Chorus', 'C'] }, 8),
  );

  it('lists all in score order for an empty query and tags the playing one', () => {
    const rows = rankSections(sections, '', 3);
    expect(rows.map((r) => r.section.label)).toEqual(['Intro', 'Chorus 1', 'Verse', 'Chorus 2']);
    expect(rows.find((r) => r.tag)?.section.label).toBe('Chorus 1');
  });

  it('finds Chorus 2 by "c2"', () => {
    expect(rankSections(sections, 'c2')[0]?.section.label).toBe('Chorus 2');
    expect(rankSections(sections, 'c2').map((r) => r.section.label)).not.toContain('Chorus 1');
  });

  it('puts the section with that letter first for one character', () => {
    expect(rankSections(sections, 'b')[0]?.section.label).toBe('Chorus 1');
  });

  it('drops non-matches', () => {
    expect(rankSections(sections, 'zzz')).toEqual([]);
  });
});
