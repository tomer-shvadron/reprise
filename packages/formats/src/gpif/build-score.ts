import {
  LYRIC_LINES,
  PPQ,
  VOICE_COUNT,
  barTicks,
  beatStartTicks,
  createBar,
  createMasterBar,
  createScoreMeta,
  formatPath,
  newId,
  validateScore,
  type Bar,
  type Beat,
  type Clef,
  type Duration,
  type GraceBeat,
  type MasterBar,
  type Note,
  type Score,
  type TempoMark,
  type Track,
} from '@reprise/model';

import { createModelTrack, planTrack, resolveNote, type TrackPlan } from './build-tracks';
import { cloneBeat, cloneChord, cloneEffects, cloneNote } from './clone';
import type {
  GpifBar,
  GpifBeat,
  GpifDocument,
  GpifRhythm,
  GpifTempo,
  SimileMark,
} from './document';
import { GpifError } from './errors';
import { dispatchLyrics } from './lyrics';
import type { TrackNotation } from './part-configuration';
import type { WarningSink } from './warnings';

/** Beat starts within this many ticks of an automation's position count as the same moment. */
const TICK_TOLERANCE = 0.5;

/** How many bars ahead a hammer-on may find its destination, as far as alphaTab's search looks. */
const HAMMER_PULL_BAR_WINDOW = 3;

const MODEL_DURATIONS: readonly Duration[] = [1, 2, 4, 8, 16, 32, 64, 128, 256];

function isDuration(value: number): value is Duration {
  return MODEL_DURATIONS.some((duration) => duration === value);
}

interface Rhythm {
  duration: Duration;
  dots: 0 | 1 | 2;
}

function dotsOf(value: number): 0 | 1 | 2 {
  return value >= 2 ? 2 : value === 1 ? 1 : 0;
}

/**
 * The model stops at the whole note; a double whole or long (quadruple whole) becomes whole
 * notes tied together, plus a half or dotted half for a dotted remainder.
 */
function splitLongRhythm(rhythm: GpifRhythm): Rhythm[] {
  const wholes = (1 / rhythm.value) * (2 - 1 / 2 ** rhythm.dots);
  const pieces: Rhythm[] = Array.from({ length: Math.floor(wholes) }, () => ({
    duration: 1,
    dots: 0,
  }));
  const rest = wholes - Math.floor(wholes);
  if (rest >= 0.75) pieces.push({ duration: 2, dots: 1 });
  else if (rest >= 0.5) pieces.push({ duration: 2, dots: 0 });
  return pieces;
}

interface PendingGrace {
  path: string;
  grace: GraceBeat;
}

interface Located {
  beat: Beat;
  exact: boolean;
}

interface PlacedBeat {
  beat: Beat;
  barIndex: number;
}

/** `staffIndex.voiceIndex`: one voice line of a track across all its bars. */
const lineKey = (staffIndex: number, voiceIndex: number): string =>
  `${String(staffIndex)}.${String(voiceIndex)}`;

/**
 * Which model voice slot each voice line of a track lands in, fixed for the whole track. The
 * model has one staff per track, so a second staff's voices share the first staff's four slots:
 * staff 1 keeps its own indices and every other line that is used anywhere takes the lowest slot
 * staff 1 never uses, in staff and voice order. A line with no slot left is absent from the map.
 * Choosing per bar instead would move a voice between slots from one bar to the next, and ties,
 * hammer-ons and grace notes all follow a slot across bars.
 */
function planVoiceSlots(document: GpifDocument, barIds: string[][]): Map<string, number> {
  const used = new Set<string>();
  for (const staves of barIds) {
    staves.forEach((id, staffIndex) => {
      document.bars.get(id)?.voiceIds.forEach((voiceId, voiceIndex) => {
        if (voiceId !== '-1') used.add(lineKey(staffIndex, voiceIndex));
      });
    });
  }
  const slots = new Map<string, number>();
  const taken = new Set<number>();
  for (let voiceIndex = 0; voiceIndex < VOICE_COUNT; voiceIndex++) {
    if (!used.has(lineKey(0, voiceIndex))) continue;
    slots.set(lineKey(0, voiceIndex), voiceIndex);
    taken.add(voiceIndex);
  }
  const free = Array.from({ length: VOICE_COUNT }, (_, slot) => slot).filter(
    (slot) => !taken.has(slot),
  );
  const others = [...used]
    .filter((line) => !line.startsWith('0.'))
    .map((line) => line.split('.').map(Number) as [number, number])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  for (const [staffIndex, voiceIndex] of others) {
    const slot = free.shift();
    if (slot !== undefined) slots.set(lineKey(staffIndex, voiceIndex), slot);
  }
  return slots;
}

/** The next note on the origin's string, or the next note at all off fretted tracks, within the window. */
function hammerPullDestination(
  beats: PlacedBeat[],
  from: number,
  note: Note,
  fretted: boolean,
): Note | undefined {
  const origin = beats[from];
  if (!origin) return undefined;
  for (let index = from + 1; index < beats.length; index++) {
    const later = beats[index];
    if (!later || later.barIndex > origin.barIndex + HAMMER_PULL_BAR_WINDOW) return undefined;
    const found = fretted
      ? later.beat.notes.find((candidate) => candidate.string === note.string)
      : later.beat.notes[0];
    if (found) return found;
  }
  return undefined;
}

class ScoreBuilder {
  readonly #sink: WarningSink;
  readonly #document: GpifDocument;
  readonly #plans: TrackPlan[];
  readonly #masterBars: MasterBar[];
  readonly #tracks: Track[];
  /** Per track, per master bar, the gpif bar ids of the track's staves. */
  readonly #barIds: string[][][];
  readonly #slots: Map<string, number>[];
  readonly #pendingGrace = new Map<string, PendingGrace[]>();
  readonly #hopoOrigins = new Map<Note, string>();
  readonly #similes: { track: number; bar: number; mark: SimileMark; path: string }[] = [];

  constructor(sink: WarningSink, document: GpifDocument, notation: TrackNotation[] | undefined) {
    this.#sink = sink;
    this.#document = document;
    const order =
      document.trackOrder.length > 0 ? document.trackOrder : [...document.tracks.keys()];
    this.#plans = [];
    for (const id of order) {
      const source = document.tracks.get(id);
      if (source) this.#plans.push(planTrack(sink, source, notation?.[this.#plans.length]));
      else
        sink.warn(
          'missing-reference',
          'MasterTrack/Tracks',
          `Track ${id} is listed but not defined; skipped`,
        );
    }
    if (this.#plans.length === 0) throw new GpifError('empty-score', 'The file defines no tracks');
    if (document.masterBars.length === 0)
      throw new GpifError('empty-score', 'The file defines no bars');

    this.#barIds = this.#plans.map(() => []);
    for (const raw of document.masterBars) {
      let cursor = 0;
      this.#plans.forEach((plan, trackIndex) => {
        const staffCount = Math.max(1, plan.source.staves.length);
        this.#barIds[trackIndex]?.push(raw.barIds.slice(cursor, cursor + staffCount));
        cursor += staffCount;
      });
      if (raw.barIds.length > cursor) {
        sink.warn(
          'missing-reference',
          raw.path,
          'More bars than the tracks have staves; the extra ones are ignored',
        );
      }
    }
    this.#slots = this.#barIds.map((barIds) => planVoiceSlots(document, barIds));

    this.#masterBars = document.masterBars.map((raw) =>
      createMasterBar({
        timeSignature: raw.timeSignature,
        keySignature: raw.keySignature,
        repeat: { start: raw.repeatStart, endCount: raw.repeatEndCount },
        alternateEndings: [...raw.alternateEndings],
        jumps: raw.jumps.map((kind) => ({ kind })),
        targets: [...raw.targets],
        ...(raw.section && { section: { ...raw.section } }),
        tripletFeel: raw.tripletFeel,
        doubleBar: raw.doubleBar,
      }),
    );
    const first = this.#masterBars[0];
    if (first && document.anacrusis) first.anacrusis = true;
    this.#tracks = this.#plans.map((plan, index) =>
      createModelTrack(plan, notation?.[index], this.#firstClef(index)),
    );
  }

  build(): Score {
    this.#document.masterBars.forEach((raw, barIndex) => {
      this.#plans.forEach((_, trackIndex) => {
        const ids = this.#barIds[trackIndex]?.[barIndex] ?? [];
        this.#tracks[trackIndex]?.bars.push(this.#buildBar(trackIndex, barIndex, ids, raw.path));
      });
    });
    for (const [key, pending] of this.#pendingGrace) {
      for (const { path } of pending) {
        this.#sink.warn(
          'grace-without-beat',
          path,
          `A grace beat at the end of voice ${key} has no beat to lead into; dropped`,
        );
      }
    }

    propagateVoltas(this.#masterBars);
    this.#applyClefChanges();
    this.#moveHammerPulls();
    this.#expandSimiles();
    this.#applyTempos();
    this.#applyTrackAutomations();
    this.#applyLyrics();

    const meta = this.#document.meta;
    if (meta.wordsAndMusic !== '' && meta.words !== '' && meta.music !== '') {
      this.#sink.warn(
        'not-modelled',
        'Score/WordsAndMusic',
        'A separate words-and-music credit is not modelled; dropped',
      );
    }
    const score: Score = {
      id: newId(),
      meta: createScoreMeta({
        title: meta.title,
        subtitle: meta.subtitle,
        artist: meta.artist,
        album: meta.album,
        words: meta.words === '' ? meta.wordsAndMusic : meta.words,
        music: meta.music === '' ? meta.wordsAndMusic : meta.music,
        copyright: meta.copyright,
        tab: meta.tab,
        instructions: meta.instructions,
        notices: meta.notices,
      }),
      masterBars: this.#masterBars,
      tracks: this.#tracks,
    };
    for (const violation of validateScore(score)) {
      this.#sink.warn(violation.rule, formatPath(['score', ...violation.path]), violation.message);
    }
    return score;
  }

  #firstClef(trackIndex: number): Clef | undefined {
    const id = this.#barIds[trackIndex]?.[0]?.[0];
    return id === undefined ? undefined : this.#document.bars.get(id)?.clef;
  }

  #gpifBar(id: string, path: string): GpifBar | undefined {
    if (id === '-1') return undefined;
    const bar = this.#document.bars.get(id);
    if (!bar)
      this.#sink.warn(
        'missing-reference',
        path,
        `Bar ${id} is referenced but not defined; left empty`,
      );
    return bar;
  }

  /**
   * One model bar from the track's staves at this master bar, each voice line in the slot
   * `planVoiceSlots` gave it; a line that got none is dropped with a warning counting its bars.
   */
  #buildBar(trackIndex: number, barIndex: number, ids: string[], path: string): Bar {
    const bar = createBar();
    const staves = ids.map((id) => this.#gpifBar(id, path));
    const plan = this.#plans[trackIndex];
    if (plan && staves.length > 1 && barIndex === 0) {
      this.#sink.warn(
        'multiple-staves',
        plan.source.path,
        `Track has ${String(staves.length)} staves; they are merged onto one`,
      );
    }
    const first = staves[0];
    if (first?.clef) bar.clef = first.clef;
    if (first?.simile)
      this.#similes.push({
        track: trackIndex,
        bar: barIndex,
        mark: first.simile,
        path: first.path,
      });

    const slots = this.#slots[trackIndex];
    staves.forEach((staff, staffIndex) => {
      staff?.voiceIds.forEach((voiceId, voiceIndex) => {
        if (voiceId === '-1') return;
        const line = lineKey(staffIndex, voiceIndex);
        const slot = slots?.get(line);
        const voice = slot === undefined ? undefined : bar.voices[slot];
        if (voice && slot !== undefined) {
          voice.beats = this.#buildVoice(trackIndex, slot, voiceId, staff.path);
        } else {
          this.#sink.warn(
            'voice-dropped',
            staff.path,
            `Voice ${String(voiceIndex + 1)} of staff ${String(staffIndex + 1)} has no free voice slot on the merged staff; dropped`,
            `${String(trackIndex)}:${line}`,
          );
        }
      });
    });
    return bar;
  }

  #buildVoice(trackIndex: number, slot: number, voiceId: string, path: string): Beat[] {
    const voice = this.#document.voices.get(voiceId);
    if (!voice) {
      this.#sink.warn(
        'missing-reference',
        path,
        `Voice ${voiceId} is referenced but not defined; left empty`,
      );
      return [];
    }
    const key = `${String(trackIndex + 1)}.${String(slot + 1)}`;
    let pending = this.#pendingGrace.get(key) ?? [];
    const beats: Beat[] = [];
    for (const beatId of voice.beatIds) {
      const source = this.#document.beats.get(beatId);
      if (!source) {
        this.#sink.warn(
          'missing-reference',
          voice.path,
          `Beat ${beatId} is referenced but not defined; skipped`,
        );
        continue;
      }
      const notes = this.#resolveNotes(trackIndex, source);
      const rhythm = this.#rhythm(source);
      if (source.grace) {
        pending.push({ path: source.path, grace: this.#graceBeat(source, rhythm, notes) });
        continue;
      }
      const built = this.#buildBeats(trackIndex, source, rhythm, notes);
      const head = built[0];
      if (head && pending.length > 0) {
        head.grace = pending.map((entry) => entry.grace);
        pending = [];
      }
      beats.push(...built);
    }
    this.#pendingGrace.set(key, pending);
    return beats;
  }

  #rhythm(beat: GpifBeat): GpifRhythm {
    const rhythm =
      beat.rhythmId === undefined ? undefined : this.#document.rhythms.get(beat.rhythmId);
    if (rhythm) return rhythm;
    this.#sink.warn(
      'missing-reference',
      beat.path,
      `Rhythm ${beat.rhythmId ?? '(none)'} is not defined; read as a quarter`,
    );
    return { path: beat.path, value: 4, dots: 0 };
  }

  #resolveNotes(trackIndex: number, beat: GpifBeat): Note[] {
    const plan = this.#plans[trackIndex];
    if (!plan) return [];
    const notes: Note[] = [];
    for (const noteId of beat.noteIds) {
      const source = this.#document.notes.get(noteId);
      if (!source) {
        this.#sink.warn(
          'missing-reference',
          beat.path,
          `Note ${noteId} is referenced but not defined; skipped`,
        );
        continue;
      }
      const note = resolveNote(this.#sink, plan, source, beat.dynamics ?? 'mf');
      if (!note) continue;
      // gpif flags both ends of a hammer-on; the destination flag is the model's.
      note.hammerPull = source.hopoDestination;
      if (source.hopoOrigin) this.#hopoOrigins.set(note, source.path);
      notes.push(note);
    }
    return notes;
  }

  #graceBeat(beat: GpifBeat, rhythm: GpifRhythm, notes: Note[]): GraceBeat {
    let duration: GraceBeat['duration'];
    if (rhythm.value === 16 || rhythm.value === 32 || rhythm.value === 64) duration = rhythm.value;
    else {
      duration = rhythm.value < 16 ? 16 : 64;
      this.#sink.warn(
        'grace-duration-clamped',
        beat.path,
        `A grace note of 1/${String(rhythm.value)} is outside 16th to 64th; read as 1/${String(duration)}`,
        'grace-duration',
      );
    }
    for (const note of notes.filter((n) => n.tie)) {
      note.tie = false;
      this.#sink.warn(
        'grace-tie-released',
        beat.path,
        'A tied grace note is played as a grace note; the model has no tied grace notes',
        'grace-tie',
      );
    }
    return { duration, before: beat.grace === 'before', notes };
  }

  #buildBeats(trackIndex: number, source: GpifBeat, rhythm: GpifRhythm, notes: Note[]): Beat[] {
    const beat: Beat = {
      id: newId(),
      duration: 4,
      dots: dotsOf(rhythm.dots),
      rest: notes.length === 0,
      notes,
      effects: cloneEffects(source.effects),
    };
    if (rhythm.tuplet) beat.tuplet = { ...rhythm.tuplet };
    if (source.text !== undefined) beat.text = source.text;
    if (source.chordId !== undefined) {
      const chord = this.#plans[trackIndex]?.staff.chords.get(source.chordId);
      if (chord) beat.chord = cloneChord(chord);
      else
        this.#sink.warn(
          'missing-reference',
          source.path,
          `Chord ${source.chordId} is not in the track's diagram collection; dropped`,
        );
    }
    if (source.lyrics) {
      if (source.lyrics.length > LYRIC_LINES) {
        this.#sink.warn(
          'not-modelled',
          source.path,
          `Lyric lines beyond ${String(LYRIC_LINES)} are not modelled; dropped`,
        );
      }
      beat.lyrics = source.lyrics.slice(0, LYRIC_LINES);
    }
    if (source.noteIds.some((id) => this.#document.notes.get(id)?.tapped === true)) {
      beat.effects.tapping = true;
    }

    if (isDuration(rhythm.value)) {
      beat.duration = rhythm.value;
      return [beat];
    }
    this.#sink.warn(
      'long-note-tied',
      rhythm.path,
      'A note longer than a whole note becomes tied whole notes',
      'long-note',
    );
    const pieces = splitLongRhythm(rhythm);
    return pieces.map((piece, index) => {
      if (index === 0) return { ...beat, duration: piece.duration, dots: piece.dots };
      const tied: Beat = {
        id: newId(),
        duration: piece.duration,
        dots: piece.dots,
        rest: beat.rest,
        notes: beat.notes.map((note) => {
          const copy = cloneNote(note);
          copy.tie = true;
          copy.hammerPull = false;
          delete copy.bend;
          delete copy.slide;
          delete copy.trill;
          return copy;
        }),
        effects: {},
      };
      if (beat.tuplet) tied.tuplet = { ...beat.tuplet };
      return tied;
    });
  }

  /** A bar's clef is a change from that bar on, so only bars that differ from the one before keep it. */
  #applyClefChanges(): void {
    for (const track of this.#tracks) {
      let current = track.display.clef;
      for (const bar of track.bars) {
        if (bar.clef === undefined) continue;
        if (bar.clef === current) delete bar.clef;
        else current = bar.clef;
      }
    }
  }

  #moveHammerPulls(): void {
    this.#tracks.forEach((track, trackIndex) => {
      const plan = this.#plans[trackIndex];
      const fretted = plan?.kind === 'fretted';
      for (let slot = 0; slot < VOICE_COUNT; slot++) {
        const beats: PlacedBeat[] = track.bars.flatMap((bar, barIndex) =>
          (bar.voices[slot]?.beats ?? []).map((beat) => ({ beat, barIndex })),
        );
        beats.forEach(({ beat }, index) => {
          for (const note of beat.notes) {
            const origin = this.#hopoOrigins.get(note);
            if (origin === undefined) continue;
            const destination = hammerPullDestination(beats, index, note, fretted);
            if (destination) destination.hammerPull = true;
            else {
              this.#sink.warn(
                'hammer-pull-without-destination',
                origin,
                `A hammer-on or pull-off with no later note on its string within ${String(HAMMER_PULL_BAR_WINDOW)} bars; dropped`,
                plan?.source.id ?? String(trackIndex),
              );
            }
          }
        });
      }
    });
  }

  /**
   * Simile marks are not modelled; the bar would play silent, so it takes a copy of the bar it
   * repeats: the previous one, or for the two-bar form the one two back.
   */
  #expandSimiles(): void {
    for (const { track, bar, mark, path } of this.#similes) {
      const sourceIndex = bar - (mark === 'simple' ? 1 : 2);
      const target = this.#tracks[track]?.bars[bar];
      const source = this.#tracks[track]?.bars[sourceIndex];
      if (!target || !source) {
        this.#sink.warn(
          'invalid-value',
          path,
          'A simile mark with no earlier bar to repeat; left as written',
        );
        continue;
      }
      target.voices.forEach((voice, slot) => {
        voice.beats = (source.voices[slot]?.beats ?? []).map((beat) => cloneBeat(beat));
      });
      this.#sink.warn(
        'simile-expanded',
        path,
        'A simile mark is not modelled; the repeated bar was copied in',
      );
    }
  }

  #locate(barIndex: number, tick: number, trackIndex?: number): Located | undefined {
    const tracks =
      trackIndex === undefined ? this.#tracks : this.#tracks.slice(trackIndex, trackIndex + 1);
    // Failing an exact match, the beat sounding at the tick in the first voice that has beats.
    let fallback: Beat | undefined;
    for (const track of tracks) {
      for (const voice of track.bars[barIndex]?.voices ?? []) {
        let sounding: Beat | undefined;
        for (let index = 0; index < voice.beats.length; index++) {
          const beat = voice.beats[index];
          if (!beat) continue;
          const start = beatStartTicks(voice, index);
          if (Math.abs(start - tick) <= TICK_TOLERANCE) return { beat, exact: true };
          if (sounding === undefined || start <= tick) sounding = beat;
        }
        fallback ??= sounding;
      }
    }
    return fallback ? { beat: fallback, exact: false } : undefined;
  }

  #tickIn(barIndex: number, position: number): number {
    const masterBar = this.#masterBars[barIndex];
    return masterBar ? position * barTicks(masterBar) : 0;
  }

  #quartersBetween(from: GpifTempo, to: GpifTempo): number {
    let ticks = -this.#tickIn(from.bar, from.position) + this.#tickIn(to.bar, to.position);
    for (let index = from.bar; index < to.bar; index++) {
      const masterBar = this.#masterBars[index];
      if (masterBar) ticks += barTicks(masterBar);
    }
    return ticks / PPQ;
  }

  #setBeatTempo(tempo: GpifTempo, mark: TempoMark & { duration?: number }): boolean {
    const located = this.#locate(tempo.bar, this.#tickIn(tempo.bar, tempo.position));
    if (!located) {
      this.#sink.warn(
        'automation-dropped',
        tempo.path,
        'A tempo change in a bar with no beats; dropped',
      );
      return false;
    }
    if (!located.exact) {
      this.#sink.warn(
        'tempo-moved',
        tempo.path,
        'A tempo change between beats moves to the beat before it',
      );
    }
    located.beat.mix = { ...located.beat.mix, tempo: mark };
    return true;
  }

  /**
   * Tempo automations at a bar's start become `MasterBar.tempo`, the others `Beat.mix.tempo` on
   * the beat at their position. A linear automation ramps from the previous one into its own
   * value; the model approximates that as a ramp starting at the previous automation, with
   * `duration` the distance in whole quarter notes.
   */
  #applyTempos(): void {
    const tempos = [...this.#document.tempos].sort(
      (a, b) => a.bar - b.bar || a.position - b.position,
    );
    let previous: GpifTempo | undefined;
    for (const tempo of tempos) {
      const masterBar = this.#masterBars[tempo.bar];
      if (!masterBar) {
        this.#sink.warn(
          'automation-dropped',
          tempo.path,
          `A tempo change on bar ${String(tempo.bar + 1)}, past the last bar; dropped`,
        );
        continue;
      }
      const mark: TempoMark = { bpm: tempo.bpm };
      if (tempo.unit) mark.unit = tempo.unit;
      if (tempo.label !== undefined) mark.label = tempo.label;
      if (tempo.position === 0) masterBar.tempo = mark;
      else this.#setBeatTempo(tempo, mark);

      if (tempo.linear && previous) {
        const quarters = this.#quartersBetween(previous, tempo);
        const duration = Math.max(1, Math.round(quarters));
        if (previous.position !== 0) {
          this.#sink.warn(
            'not-modelled',
            tempo.path,
            'A ramp from a mid-bar tempo starts from the tempo before it',
            'mid-bar-ramp',
          );
        }
        if (duration !== quarters) {
          this.#sink.warn(
            'tempo-moved',
            tempo.path,
            `A tempo ramp of ${quarters.toFixed(2)} quarter notes is rounded to ${String(duration)}`,
          );
        }
        this.#setBeatTempo(previous, { ...mark, duration });
      }
      previous = tempo;
    }
    const first = this.#masterBars[0];
    if (first && !first.tempo) {
      first.tempo = { bpm: 120 };
      this.#sink.warn(
        'default-tempo',
        'MasterTrack/Automations',
        "No tempo at the start; Guitar Pro's default of 120 BPM is used",
      );
    }
  }

  #applyTrackAutomations(): void {
    this.#plans.forEach((plan, trackIndex) => {
      const track = this.#tracks[trackIndex];
      if (!track) return;
      for (const automation of plan.source.automations) {
        if (automation.type === 'Sound') {
          const sound = plan.source.sounds.get(automation.value);
          if (!sound) {
            this.#sink.warn(
              'missing-reference',
              automation.path,
              `Sound "${automation.value}" is not defined; dropped`,
            );
            continue;
          }
          const initial = automation.bar === 0 && automation.position === 0;
          if (initial && sound.program === track.program && sound.bank === track.bank) continue;
          if (sound.bank !== track.bank) {
            this.#sink.warn(
              'not-modelled',
              automation.path,
              'A mid-song bank change is not modelled; dropped',
            );
          }
          const located = this.#locate(
            automation.bar,
            this.#tickIn(automation.bar, automation.position),
            trackIndex,
          );
          if (located) located.beat.mix = { ...located.beat.mix, program: sound.program };
          else
            this.#sink.warn(
              'automation-dropped',
              automation.path,
              'A sound change in a bar with no beats; dropped',
            );
        } else {
          this.#sink.warn(
            'not-modelled',
            automation.path,
            `A ${automation.type} automation is not modelled; dropped`,
            `${plan.source.id}:${automation.type}`,
          );
        }
      }
    });
  }

  #applyLyrics(): void {
    this.#tracks.forEach((track, index) => {
      if (track.lyrics.length > LYRIC_LINES) {
        const path = `${this.#plans[index]?.source.path ?? 'Tracks/Track'}/Lyrics`;
        this.#sink.warn(
          'not-modelled',
          path,
          `Lyric lines beyond ${String(LYRIC_LINES)} are not modelled; dropped`,
        );
        track.lyrics = track.lyrics.slice(0, LYRIC_LINES);
      }
      if (track.lyrics.length === 0) return;
      const hasBeatLyrics = track.bars.some((bar) =>
        bar.voices.some((voice) => voice.beats.some((beat) => beat.lyrics)),
      );
      if (!hasBeatLyrics) dispatchLyrics(track, track.lyrics);
    });
  }
}

/**
 * gpif marks a volta bracket only on its first bar; the model marks every bar of it, through
 * the bar that closes the repeat. A bracket with no repeat end ahead (the final ending) stays
 * one bar long, since nothing says where it stops.
 */
export function propagateVoltas(masterBars: MasterBar[]): void {
  for (let index = 0; index < masterBars.length; index++) {
    const bar = masterBars[index];
    if (!bar || bar.alternateEndings.length === 0 || bar.repeat.endCount > 0) continue;
    for (let next = index + 1; next < masterBars.length; next++) {
      const candidate = masterBars[next];
      if (!candidate || candidate.alternateEndings.length > 0 || candidate.repeat.start) break;
      if (candidate.repeat.endCount > 0) {
        for (let fill = index + 1; fill <= next; fill++) {
          const filled = masterBars[fill];
          if (filled) filled.alternateEndings = [...bar.alternateEndings];
        }
        index = next;
        break;
      }
    }
  }
}

export function buildScore(
  sink: WarningSink,
  document: GpifDocument,
  notation?: TrackNotation[],
): Score {
  return new ScoreBuilder(sink, document, notation).build();
}
