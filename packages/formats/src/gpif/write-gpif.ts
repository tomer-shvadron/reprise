import type {
  Beat,
  Chord,
  Clef,
  DirectionTarget,
  Dynamics,
  GraceBeat,
  JumpKind,
  MasterBar,
  NativePath,
  Note,
  Score,
  TempoUnit,
  Track,
  TripletFeel,
  Tuplet,
} from '@reprise/model';
import { tieOriginOf } from '@reprise/model';

import { propagateVoltas } from './build-score';
import { DropCollector, type GpifDropped } from './dropped';
import { writeCurve, whammyProperties, writeNote } from './write-notes';
import { planTempos } from './write-tempo';
import {
  chordKey,
  drumArticulations,
  drumKit,
  impliedBarres,
  planTrack,
  reportTrackLosses,
  sortedBarres,
  writeTrack,
  type DrumElement,
  type TrackPlan,
} from './write-tracks';
import { XmlWriter, hasInvalidXmlCharacters } from './xml-writer';

export interface GpifWriteResult {
  /** The `score.gpif` document. */
  xml: string;
  /** Score features the document could not carry, folded per kind of loss. */
  dropped: GpifDropped[];
}

const JUMPS: Readonly<Record<JumpKind, string>> = {
  daCapo: 'DaCapo',
  dcAlCoda: 'DaCapoAlCoda',
  dcAlDoubleCoda: 'DaCapoAlDoubleCoda',
  dcAlFine: 'DaCapoAlFine',
  dalSegno: 'DaSegno',
  dsAlCoda: 'DaSegnoAlCoda',
  dsAlDoubleCoda: 'DaSegnoAlDoubleCoda',
  dsAlFine: 'DaSegnoAlFine',
  dalSegnoSegno: 'DaSegnoSegno',
  dssAlCoda: 'DaSegnoSegnoAlCoda',
  dssAlDoubleCoda: 'DaSegnoSegnoAlDoubleCoda',
  dssAlFine: 'DaSegnoSegnoAlFine',
  // gpif calls the "To Coda" sign "Da Coda".
  toCoda: 'DaCoda',
  toDoubleCoda: 'DaDoubleCoda',
};

const TARGETS: Readonly<Record<DirectionTarget, string>> = {
  segno: 'Segno',
  segnoSegno: 'SegnoSegno',
  coda: 'Coda',
  doubleCoda: 'DoubleCoda',
  fine: 'Fine',
};

const TRIPLET_FEELS: Readonly<Record<TripletFeel, string>> = {
  none: 'NoTripletFeel',
  eighth: 'Triplet8th',
  sixteenth: 'Triplet16th',
  dottedEighth: 'Dotted8th',
  dottedSixteenth: 'Dotted16th',
  scottishEighth: 'Scottish8th',
  scottishSixteenth: 'Scottish16th',
};

const CLEFS: Readonly<Record<Clef, string>> = {
  treble: 'G2',
  bass: 'F4',
  alto: 'C3',
  tenor: 'C4',
  percussion: 'Neutral',
};

const NOTE_VALUES: Readonly<Record<Beat['duration'], string>> = {
  1: 'Whole',
  2: 'Half',
  4: 'Quarter',
  8: 'Eighth',
  16: '16th',
  32: '32nd',
  64: '64th',
  128: '128th',
  256: '256th',
};

/** gpif tempo units 1 to 5 and the factor from "unit = value" to quarter-note BPM. */
const TEMPO_UNITS: Readonly<Record<TempoUnit, readonly [unit: number, factor: number]>> = {
  eighth: [1, 0.5],
  quarter: [2, 1],
  dottedQuarter: [3, 1.5],
  half: [4, 2],
  dottedHalf: [5, 3],
};

const TREMOLO = { 8: '1/2', 16: '1/4', 32: '1/8' } as const;

/** A stroke's spread as MIDI ticks at 960 per quarter, the beat `XProperty` 687935489. */
const STROKE_TICKS = { 4: 960, 8: 480, 16: 240, 32: 120, 64: 60, 128: 30 } as const;
const STROKE_LENGTH_ID = '687935489';

const sameList = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * gpif marks a volta bracket on its first bar only, and the reader carries the numbers on through
 * the bar that closes the repeat. Each run of equal numbers is written on its first bar; a run
 * the reader would not rebuild that way is written on every bar, and whatever still reads back
 * differently is reported.
 */
function voltaMarks(masterBars: readonly MasterBar[], drops: DropCollector): number[][] {
  const model = masterBars.map((bar) => bar.alternateEndings);
  const simulate = (marks: number[][]): number[][] => {
    const copies = masterBars.map((bar, index) => ({
      ...bar,
      alternateEndings: [...(marks[index] ?? [])],
    }));
    propagateVoltas(copies);
    return copies.map((bar) => bar.alternateEndings);
  };
  const marks = model.map((endings, index) => {
    const previous = model[index - 1];
    return index > 0 && previous && sameList(previous, endings) ? [] : [...endings];
  });
  const firstPass = simulate(marks);
  model.forEach((endings, index) => {
    if (sameList(firstPass[index] ?? [], endings) || endings.length === 0) return;
    let start = index;
    while (start > 0 && sameList(model[start - 1] ?? [], endings)) start--;
    for (let bar = start; bar < model.length && sameList(model[bar] ?? [], endings); bar++) {
      marks[bar] = [...endings];
    }
  });
  const secondPass = simulate(marks);
  model.forEach((endings, index) => {
    if (!sameList(secondPass[index] ?? [], endings)) {
      drops.drop(
        'volta-bracket',
        ['masterBars', index, 'alternateEndings'],
        'A volta bracket gpif cannot mark: its bars read back with other numbers',
      );
    }
  });
  return marks;
}

const isEmptyBeat = (beat: Beat): boolean =>
  !beat.rest && beat.notes.length === 0 && (beat.grace ?? []).length === 0;

interface PlacedBeat {
  beat: Beat;
  bar: number;
}

/** A voice slot of a track across all its bars, grace beats left out as the reader leaves them. */
function voiceLine(track: Track, slot: number): PlacedBeat[] {
  return track.bars.flatMap((bar, index) =>
    (bar.voices[slot]?.beats ?? []).map((beat) => ({ beat, bar: index })),
  );
}

/** How far ahead the reader looks for a hammer-on's destination, in bars. */
const HAMMER_PULL_BAR_WINDOW = 3;

/**
 * Notes that start a tie, and notes that start a hammer-on or pull-off. gpif flags both ends of
 * each; the model flags the destination. A tie's origin is the model's (`tieOriginOf`: the last
 * note in the slot within three bars). A hammer-on origin is the previous note on the string (the
 * previous note at all off fretted tracks, where the destination must be the first note of its
 * beat), and only where the reader, searching forward from it, would find this destination.
 */
function linkOrigins(track: Track): { ties: Set<Note>; hopos: Set<Note> } {
  const ties = new Set<Note>();
  const hopos = new Set<Note>();
  const fretted = track.kind === 'fretted';
  track.bars.forEach((bar, barIndex) => {
    bar.voices.forEach((voice, slot) => {
      voice.beats.forEach((beat, beatIndex) => {
        for (const note of beat.notes) {
          if (!note.tie) continue;
          const origin = tieOriginOf(track, { bar: barIndex, voice: slot, beat: beatIndex }, note);
          if (origin) ties.add(origin.note);
        }
      });
    });
  });
  for (let slot = 0; slot < 4; slot++) {
    const line = voiceLine(track, slot);
    line.forEach(({ beat, bar }, index) => {
      const graces = (beat.grace ?? []).map((grace) => grace.notes);
      graces.forEach((notes, step) => {
        for (const note of notes) {
          if (!note.hammerPull) continue;
          const origin = hammerPullOrigin(graces.slice(0, step), note, fretted);
          if (origin) hopos.add(origin);
        }
      });
      for (const note of beat.notes) {
        if (!note.hammerPull || (!fretted && beat.notes[0] !== note)) continue;
        // A grace note before the beat on this string is the origin the reader links to it.
        const grace = hammerPullOrigin(graces, note, fretted);
        if (grace) {
          hopos.add(grace);
          continue;
        }
        for (let back = index - 1; back >= 0; back--) {
          const earlier = line[back];
          if (!earlier) break;
          const origin = fretted
            ? earlier.beat.notes.find((candidate) => candidate.string === note.string)
            : earlier.beat.notes[0];
          if (!origin) continue;
          if (bar <= earlier.bar + HAMMER_PULL_BAR_WINDOW) hopos.add(origin);
          break;
        }
      }
    });
  }
  return { ties, hopos };
}

/** The last note of the earlier graces on the string (the last note at all off fretted tracks). */
function hammerPullOrigin(earlier: Note[][], note: Note, fretted: boolean): Note | undefined {
  for (let index = earlier.length - 1; index >= 0; index--) {
    const notes = earlier[index] ?? [];
    const found = fretted ? notes.find((candidate) => candidate.string === note.string) : notes[0];
    if (found) return found;
  }
  return undefined;
}

interface Ids {
  bar: number;
  voice: number;
  beat: number;
  note: number;
}

/** Everything the beat and note writers share across one document. */
class BodyWriter {
  readonly bars = new XmlWriter();
  readonly voices = new XmlWriter();
  readonly beats = new XmlWriter();
  readonly notes = new XmlWriter();
  readonly rhythms = new XmlWriter();
  readonly #rhythmIds = new Map<string, number>();
  readonly #ids: Ids = { bar: 0, voice: 0, beat: 0, note: 0 };
  readonly #score: Score;
  readonly #drops: DropCollector;
  readonly #checkText: (text: string, path: NativePath) => void;

  constructor(
    score: Score,
    drops: DropCollector,
    checkText: (text: string, path: NativePath) => void,
  ) {
    this.#score = score;
    this.#drops = drops;
    this.#checkText = checkText;
  }

  nextBarId(): number {
    return this.#ids.bar++;
  }

  #rhythm(duration: Beat['duration'], dots: number, tuplet: Tuplet | undefined): number {
    const key = `${String(duration)}:${String(dots)}:${tuplet ? `${String(tuplet.n)}/${String(tuplet.of)}` : ''}`;
    const known = this.#rhythmIds.get(key);
    if (known !== undefined) return known;
    const id = this.#rhythmIds.size;
    this.#rhythmIds.set(key, id);
    this.rhythms.open('Rhythm', { id: String(id) });
    this.rhythms.text('NoteValue', NOTE_VALUES[duration]);
    if (dots > 0) this.rhythms.empty('AugmentationDot', { count: String(dots) });
    if (tuplet) {
      this.rhythms.empty('PrimaryTuplet', { num: String(tuplet.n), den: String(tuplet.of) });
    }
    this.rhythms.close('Rhythm');
    return id;
  }

  /** gpif keeps one dynamic per beat; the notes' shared one, or the first note's. */
  #dynamic(notes: readonly Note[], path: NativePath): Dynamics {
    const first = notes[0]?.dynamics ?? 'mf';
    if (notes.some((note) => note.dynamics !== first)) {
      this.#drops.drop(
        'note-dynamics',
        path,
        "Notes of one beat with different dynamics take the first note's",
      );
    }
    return first;
  }

  writeBar(
    trackIndex: number,
    track: Track,
    barIndex: number,
    clef: Clef,
    context: TrackBodyContext,
  ): number {
    const id = this.nextBarId();
    const bar = track.bars[barIndex];
    const voiceIds = (bar?.voices ?? []).map((voice, slot) => {
      // GP5's unused voice is a row of empty beats, which says nothing: gpif leaves it out.
      if (voice.beats.every(isEmptyBeat)) return -1;
      const voiceId = this.#ids.voice++;
      const beatIds = voice.beats.flatMap((beat, beatIndex) =>
        this.#writeBeat(beat, {
          ...context,
          barIndex,
          path: ['tracks', trackIndex, 'bars', barIndex, 'voices', slot, 'beats', beatIndex],
        }),
      );
      this.voices.open('Voice', { id: String(voiceId) });
      this.voices.text('Beats', beatIds.join(' '));
      this.voices.close('Voice');
      return voiceId;
    });
    while (voiceIds.length < 4) voiceIds.push(-1);
    this.bars.open('Bar', { id: String(id) });
    this.bars.text('Clef', CLEFS[clef]);
    this.bars.text('Voices', voiceIds.join(' '));
    this.bars.close('Bar');
    return id;
  }

  #writeNotes(notes: readonly Note[], context: BeatContext, tapped: boolean, path: NativePath) {
    const { track } = context;
    const key = this.#score.masterBars[context.barIndex]?.keySignature ?? {
      fifths: 0,
      minor: false,
    };
    return notes.map((note, index) => {
      const id = this.#ids.note++;
      const articulation = track.kind === 'drums' ? context.drums.indexOf(note.fret) : undefined;
      writeNote(this.notes, id, note, {
        track,
        key,
        ...(articulation !== undefined && articulation >= 0 && { articulation }),
        tieOrigin: context.links.ties.has(note),
        hopoOrigin: context.links.hopos.has(note),
        tapped,
        path: [...path, index],
        drops: this.#drops,
      });
      return id;
    });
  }

  #writeGrace(grace: GraceBeat, context: BeatContext, index: number): number {
    const id = this.#ids.beat++;
    const path: NativePath = [...context.path, 'grace', index];
    const dynamic = this.#dynamic(grace.notes, path);
    const rhythm = this.#rhythm(grace.duration, 0, undefined);
    const noteIds = this.#writeNotes(grace.notes, context, false, [...path, 'notes']);
    this.beats.open('Beat', { id: String(id) });
    this.beats.text('Dynamic', dynamic.toUpperCase());
    this.beats.text('GraceNotes', grace.before ? 'BeforeBeat' : 'OnBeat');
    this.beats.empty('Rhythm', { ref: String(rhythm) });
    if (noteIds.length > 0) this.beats.text('Notes', noteIds.join(' '));
    this.beats.close('Beat');
    return id;
  }

  /** The beat's grace beats, then the beat; returns their ids in voice order. */
  #writeBeat(beat: Beat, context: BeatContext): number[] {
    const { path } = context;
    const ids = (beat.grace ?? []).map((grace, index) => this.#writeGrace(grace, context, index));
    const { effects } = beat;
    const drop = this.#drops;

    if (!beat.rest && beat.notes.length === 0) {
      drop.drop('empty-beat', path, 'An empty beat (no notes, not a rest) is written as a rest');
    }
    if (effects.tapping === true && beat.notes.length === 0) {
      drop.drop(
        'tapping-without-notes',
        [...path, 'effects', 'tapping'],
        'Tapping on a beat with no notes',
      );
    }
    const fades = [effects.fadeIn, effects.fadeOut, effects.volumeSwell].filter(Boolean).length;
    if (fades > 1) {
      drop.drop(
        'fade',
        [...path, 'effects'],
        'Only one of fade in, fade out and volume swell is kept',
      );
    }
    const mix = beat.mix;
    if (
      mix &&
      (['volume', 'pan', 'chorus', 'reverb', 'phaser', 'tremolo'] as const).some((k) => mix[k])
    ) {
      drop.drop(
        'mixer-change',
        [...path, 'mix'],
        'Volume, pan and effect changes on beats have no gp equivalent',
      );
    }
    // gpif has one stroke per beat (alphaTab's `brushType`): a brush beside an arpeggio keeps the brush.
    const arpeggio = effects.brush ? undefined : effects.arpeggio;
    if (effects.brush && effects.arpeggio) {
      drop.drop(
        'stroke',
        [...path, 'effects', 'arpeggio'],
        'A beat with both a brush and an arpeggio keeps the brush; gpif has one stroke per beat',
      );
    }
    const stroke = effects.brush ? effects.brush.duration : arpeggio?.duration;

    const dynamic = this.#dynamic(beat.notes, path);
    const rhythm = this.#rhythm(beat.duration, beat.dots, beat.tuplet);
    const noteIds = this.#writeNotes(beat.notes, context, effects.tapping === true, [
      ...path,
      'notes',
    ]);
    const id = this.#ids.beat++;
    ids.push(id);

    const xml = this.beats;
    xml.open('Beat', { id: String(id) });
    xml.text('Dynamic', dynamic.toUpperCase());
    if (beat.chord) xml.text('Chord', context.plan.chordIds.get(chordKey(beat.chord)) ?? '0');
    if (effects.fadeIn === true) xml.text('Fadding', 'FadeIn');
    else if (effects.fadeOut === true) xml.text('Fadding', 'FadeOut');
    else if (effects.volumeSwell === true) xml.text('Fadding', 'VolumeSwell');
    if (effects.tremoloPicking !== undefined) xml.text('Tremolo', TREMOLO[effects.tremoloPicking]);
    if (arpeggio) xml.text('Arpeggio', arpeggio.direction === 'up' ? 'Up' : 'Down');
    if (beat.text !== undefined) {
      this.#checkText(beat.text, [...path, 'text']);
      xml.cdata('FreeText', beat.text);
    }
    xml.empty('Rhythm', { ref: String(rhythm) });
    if (noteIds.length > 0) xml.text('Notes', noteIds.join(' '));

    xml.open('Properties');
    const direction = (name: string, value: 'up' | 'down'): void => {
      xml.open('Property', { name });
      xml.text('Direction', value === 'up' ? 'Up' : 'Down');
      xml.close('Property');
    };
    const enable = (name: string): void => {
      xml.open('Property', { name });
      xml.empty('Enable');
      xml.close('Property');
    };
    if (effects.brush) direction('Brush', effects.brush.direction);
    if (effects.pickStroke) direction('PickStroke', effects.pickStroke);
    if (effects.slapping === true) enable('Slapped');
    if (effects.popping === true) enable('Popped');
    if (effects.vibrato !== undefined && effects.vibrato !== 'none') {
      xml.open('Property', { name: 'VibratoWTremBar' });
      xml.text('Strength', effects.vibrato === 'wide' ? 'Wide' : 'Slight');
      xml.close('Property');
    }
    if (effects.whammy) {
      enable('WhammyBar');
      writeCurve(
        xml,
        'WhammyBar',
        whammyProperties(effects.whammy, [...path, 'effects', 'whammy'], drop),
      );
    }
    xml.close('Properties');
    if (stroke !== undefined) {
      xml.open('XProperties');
      xml.open('XProperty', { id: STROKE_LENGTH_ID });
      xml.text('Int', STROKE_TICKS[stroke]);
      xml.close('XProperty');
      xml.close('XProperties');
    }
    if (beat.lyrics) {
      xml.open('Lyrics');
      beat.lyrics.forEach((line, index) => {
        this.#checkText(line, [...path, 'lyrics', index]);
        xml.cdata('Line', line);
      });
      xml.close('Lyrics');
    }
    xml.close('Beat');
    return ids;
  }
}

interface TrackBodyContext {
  track: Track;
  plan: TrackPlan;
  kit: DrumElement[];
  /** The kit's articulations' MIDI notes, in the order notes index them. */
  drums: number[];
  links: { ties: Set<Note>; hopos: Set<Note> };
}

interface BeatContext extends TrackBodyContext {
  barIndex: number;
  path: NativePath;
}

function reportChordLosses(plan: TrackPlan, trackIndex: number, drops: DropCollector): void {
  for (const chord of plan.chords) {
    const diagram = chord.diagram;
    if (!diagram) continue;
    const fingerOnMuted = diagram.fingering?.some(
      (finger, slot) => finger !== null && (diagram.frets[slot] ?? null) === null,
    );
    const noFingers = diagram.fingering?.every((finger) => finger === null) === true;
    if (fingerOnMuted === true || noFingers || impliedBarres(chord) !== sortedBarres(chord)) {
      drops.drop(
        'chord-barre',
        ['tracks', trackIndex],
        `Chord "${chord.name}": gpif stores no barres, only fingers, and a barre reads back only where one finger covers its strings`,
      );
    }
  }
}

function effectiveClefs(track: Track): Clef[] {
  let clef: Clef = track.display.clef ?? (track.kind === 'drums' ? 'percussion' : 'treble');
  return track.bars.map((bar) => {
    if (bar.clef) clef = bar.clef;
    return clef;
  });
}

function writeMasterBar(
  xml: XmlWriter,
  masterBar: MasterBar,
  endings: number[],
  barIds: number[],
): void {
  xml.open('MasterBar');
  xml.open('Key');
  xml.text('AccidentalCount', masterBar.keySignature.fifths);
  xml.text('Mode', masterBar.keySignature.minor ? 'Minor' : 'Major');
  xml.text('TransposeAs', 'Sharps');
  xml.close('Key');
  const { numerator, denominator } = masterBar.timeSignature;
  xml.text('Time', `${String(numerator)}/${String(denominator)}`);
  const { start, endCount } = masterBar.repeat;
  if (start || endCount > 0) {
    xml.empty('Repeat', {
      start: String(start),
      end: String(endCount > 0),
      // Already the section's total plays, as the model counts them.
      count: String(endCount),
    });
  }
  if (endings.length > 0) xml.text('AlternateEndings', endings.join(' '));
  if (masterBar.jumps.length > 0 || masterBar.targets.length > 0) {
    xml.open('Directions');
    for (const target of masterBar.targets) xml.text('Target', TARGETS[target]);
    for (const jump of masterBar.jumps) xml.text('Jump', JUMPS[jump.kind]);
    xml.close('Directions');
  }
  if (masterBar.section) {
    xml.open('Section');
    xml.cdata('Letter', masterBar.section.letter ?? '');
    xml.cdata('Text', masterBar.section.name);
    xml.close('Section');
  }
  if (masterBar.tripletFeel !== 'none')
    xml.text('TripletFeel', TRIPLET_FEELS[masterBar.tripletFeel]);
  if (masterBar.doubleBar) xml.empty('DoubleBar');
  xml.text('Bars', barIds.join(' '));
  xml.close('MasterBar');
}

function tempoValue(bpm: number, unit: TempoUnit | undefined): string {
  const [code, factor] = TEMPO_UNITS[unit ?? 'quarter'];
  return `${String(bpm / factor)} ${String(code)}`;
}

/**
 * Writes a score as a `score.gpif` document, the inverse of `readGpif`'s mapping for everything
 * gpif can hold. Ids are sequential per section, so the same score always gives the same
 * document. What the model holds and gpif cannot is listed in `dropped`.
 */
export function writeGpif(score: Score): GpifWriteResult {
  const drops = new DropCollector();
  const checkText = (text: string, path: NativePath): void => {
    if (hasInvalidXmlCharacters(text)) {
      drops.drop('text-characters', path, 'Characters XML cannot hold were removed from text');
    }
  };

  const xml = new XmlWriter().declaration();
  xml.open('GPIF');
  xml.text('GPVersion', '7');
  xml.text('GPRevision', '12025', { required: '12021', recommended: '12023' });
  xml.open('Encoding');
  xml.text('EncodingDescription', 'GP7');
  xml.close('Encoding');

  const { meta } = score;
  xml.open('Score');
  const metaFields = [
    ['Title', meta.title, 'title'],
    ['SubTitle', meta.subtitle, 'subtitle'],
    ['Artist', meta.artist, 'artist'],
    ['Album', meta.album, 'album'],
    ['Words', meta.words, 'words'],
    ['Music', meta.music, 'music'],
    ['WordsAndMusic', '', ''],
    ['Copyright', meta.copyright, 'copyright'],
    ['Tabber', meta.tab, 'tab'],
    ['Instructions', meta.instructions, 'instructions'],
  ] as const;
  for (const [name, value, field] of metaFields) {
    if (field !== '') checkText(value, ['meta', field]);
    xml.cdata(name, value);
  }
  const notices = meta.notices;
  if ((notices.length === 1 && notices[0] === '') || notices.some((line) => /[\r\n]/.test(line))) {
    drops.drop(
      'notices',
      ['meta', 'notices'],
      'Notices are one text block split by line; empty or multi-line notices change',
    );
  }
  notices.forEach((line, index) => {
    checkText(line, ['meta', 'notices', index]);
  });
  xml.cdata('Notices', notices.join('\n'));
  xml.close('Score');

  const first = score.masterBars[0];
  score.masterBars.forEach((masterBar, index) => {
    if (index > 0 && masterBar.anacrusis) {
      drops.drop(
        'anacrusis',
        ['masterBars', index, 'anacrusis'],
        'Only the first bar can be a pickup in gp',
      );
    }
    if (masterBar.section) {
      checkText(masterBar.section.name, ['masterBars', index, 'section', 'name']);
      if (masterBar.section.letter !== undefined) {
        checkText(masterBar.section.letter, ['masterBars', index, 'section', 'letter']);
      }
      if (masterBar.section.color !== undefined) {
        drops.drop(
          'section-color',
          ['masterBars', index, 'section', 'color'],
          'Section colours are not in gp files',
        );
      }
    }
  });

  xml.open('MasterTrack');
  xml.text('Tracks', score.tracks.map((_, index) => index).join(' '));
  xml.open('Automations');
  for (const automation of planTempos(score, drops)) {
    xml.open('Automation');
    xml.text('Type', 'Tempo');
    xml.text('Linear', String(automation.linear));
    xml.text('Bar', automation.bar);
    xml.text('Position', automation.position);
    xml.text('Visible', 'true');
    xml.text('Value', tempoValue(automation.mark.bpm, automation.mark.unit));
    if (automation.mark.label !== undefined) {
      checkText(automation.mark.label, ['masterBars', automation.bar, 'tempo', 'label']);
      xml.cdata('Text', automation.mark.label);
    }
    xml.close('Automation');
  }
  xml.close('Automations');
  if (first?.anacrusis === true) xml.empty('Anacrusis');
  xml.close('MasterTrack');

  const contexts: TrackBodyContext[] = score.tracks.map((track, index) => {
    reportTrackLosses(track, index, drops);
    checkText(track.name, ['tracks', index, 'name']);
    checkText(track.shortName, ['tracks', index, 'shortName']);
    track.lyrics.forEach((line, lineIndex) => {
      checkText(line.text, ['tracks', index, 'lyrics', lineIndex, 'text']);
    });
    const plan = planTrack(track, index, score.masterBars, drops);
    reportChordLosses(plan, index, drops);
    plan.chords.forEach((chord: Chord) => {
      checkText(chord.name, ['tracks', index]);
    });
    const kit = track.kind === 'drums' ? drumKit(track) : [];
    return { track, plan, kit, drums: drumArticulations(kit), links: linkOrigins(track) };
  });

  xml.open('Tracks');
  contexts.forEach(({ track, plan, kit }, index) => {
    const beatLyrics = track.bars.some((bar) =>
      bar.voices.some((voice) => voice.beats.some((beat) => beat.lyrics !== undefined)),
    );
    writeTrack(xml, track, { index, plan, kit, beatLyrics });
  });
  xml.close('Tracks');

  const body = new BodyWriter(score, drops, checkText);
  const clefs = score.tracks.map((track) => effectiveClefs(track));
  const endings = voltaMarks(score.masterBars, drops);
  const masterBars = new XmlWriter();
  masterBars.open('MasterBars');
  score.masterBars.forEach((masterBar, barIndex) => {
    const barIds = contexts.map((context, trackIndex) =>
      body.writeBar(
        trackIndex,
        context.track,
        barIndex,
        clefs[trackIndex]?.[barIndex] ?? 'treble',
        context,
      ),
    );
    writeMasterBar(masterBars, masterBar, endings[barIndex] ?? [], barIds);
  });
  masterBars.close('MasterBars');

  xml.append(masterBars);
  for (const [name, section] of [
    ['Bars', body.bars],
    ['Voices', body.voices],
    ['Beats', body.beats],
    ['Notes', body.notes],
    ['Rhythms', body.rhythms],
  ] as const) {
    xml.open(name);
    xml.append(section);
    xml.close(name);
  }
  xml.close('GPIF');
  return { xml: xml.toString(), dropped: drops.dropped };
}
