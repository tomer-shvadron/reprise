import {
  beatStartTicks,
  chain,
  replaceBeats,
  type Beat,
  type Command,
  type Id,
  type Score,
} from '@reprise/model';

import type { SelectionState } from '@/state/selection';

import {
  CLIPBOARD_VERSION,
  type Clip,
  type ClipBar,
  type ClipTrack,
  type ClipVoice,
} from './clipboard-format';
import { resolveCursor } from './cursor';
import { rangeBeats, rangeSpan, type RangeVoice } from './range';

type CopyState = Pick<SelectionState, 'cursor' | 'range'>;

export type Refused = { refused: string };

const NOTHING = 'There is nothing to copy: put the cursor on a beat or select some';

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** "4 bars" or "3 beats", with "in 2 tracks" when the clip spans several. */
export function clipSummary(clip: Clip): string {
  const first = clip.tracks[0];
  const count =
    clip.kind === 'bars'
      ? (first?.bars.length ?? 0)
      : (first?.bars.reduce(
          (sum, bar) => sum + bar.voices.reduce((beats, voice) => beats + voice.beats.length, 0),
          0,
        ) ?? 0);
  const what = clip.kind === 'bars' ? plural(count, 'bar') : plural(count, 'beat');
  return clip.tracks.length > 1 ? `${what} in ${plural(clip.tracks.length, 'track')}` : what;
}

/** A tie reaches back to a note the clip does not hold, so the first beat of a run starts untied. */
function untied(beat: Beat): Beat {
  return beat.notes.some(({ tie }) => tie)
    ? { ...beat, notes: beat.notes.map((note) => ({ ...note, tie: false })) }
    : beat;
}

/**
 * Clears the tie on the first beat of each voice's run: the first bar's, and any bar whose
 * previous bar holds nothing of that voice. A tie inside the clip stays.
 */
function releaseOrphanTies(bars: ClipBar[]): ClipBar[] {
  return bars.map((bar, k) => ({
    ...bar,
    voices: bar.voices.map((voice) => {
      const continues = k > 0 && bars[k - 1]?.voices.some((v) => v.voice === voice.voice);
      const [first, ...rest] = voice.beats;
      return !continues && first ? { ...voice, beats: [untied(first), ...rest] } : voice;
    }),
  }));
}

/** A lone voice has no neighbour to line up with: it pastes where the cursor is, so it starts at 0. */
function alignSingleVoice(bars: ClipBar[]): ClipBar[] {
  const used = new Set(bars.flatMap((bar) => bar.voices.map(({ voice }) => voice)));
  if (used.size !== 1) return bars;
  return bars.map((bar, k) =>
    k === 0 ? { ...bar, voices: bar.voices.map((voice) => ({ ...voice, offset: 0 })) } : bar,
  );
}

function clipTrack(
  score: Score,
  trackId: Id,
  bars: { bar: number; voices: ClipVoice[] }[],
): ClipTrack | undefined {
  const track = score.tracks.find(({ id }) => id === trackId);
  if (!track) return undefined;
  const clipBars: ClipBar[] = bars.flatMap(({ bar, voices }) => {
    const masterBar = score.masterBars[bar];
    return masterBar ? [{ timeSignature: { ...masterBar.timeSignature }, voices }] : [];
  });
  return {
    kind: track.kind,
    tuning: [...track.tuning],
    fretCount: track.fretCount,
    name: track.name,
    bars: clipBars,
  };
}

/** The voices of `track`'s bar `bar` that hold beats in `parts`, with each one's start in ticks. */
function voicesOf(
  score: Score,
  parts: readonly RangeVoice[],
  trackId: Id,
  bar: number,
  from: number,
): ClipVoice[] {
  const track = score.tracks.find(({ id }) => id === trackId);
  return parts
    .filter((part) => part.track === trackId && part.bar === bar)
    .map((part) => {
      const voice = track?.bars[bar]?.voices[part.voice];
      const first = part.beats[0];
      const index = first && voice ? voice.beats.indexOf(first) : -1;
      const onset = voice && index >= 0 ? beatStartTicks(voice, index) : 0;
      return { voice: part.voice, offset: Math.max(0, onset - from), beats: [...part.beats] };
    });
}

/**
 * What a copy takes: the range's beats or bars across its visible tracks, else the beat under
 * the cursor as a one-beat clip. A beats range keeps every voice; a bars range keeps all four of
 * every bar, empty ones too.
 */
export function copyClip(
  score: Score,
  state: CopyState,
  visible?: readonly Id[],
): { clip: Clip } | Refused {
  const { range, cursor } = state;
  if (range) {
    const span = rangeSpan(score, range, visible);
    if (!span) return { refused: NOTHING };
    const last = Math.min(span.end.bar, score.masterBars.length - 1);
    const parts = rangeBeats(score, range, visible);
    const tracks = span.tracks.flatMap((trackId) => {
      const bars: { bar: number; voices: ClipVoice[] }[] = [];
      for (let bar = span.start.bar; bar <= last; bar++) {
        const from = bar === span.start.bar ? span.start.tick : 0;
        const found = voicesOf(score, parts, trackId, bar, from);
        const voices =
          range.kind === 'bars'
            ? [0, 1, 2, 3].map(
                (voice) => found.find((entry) => entry.voice === voice) ?? voiceless(voice),
              )
            : found;
        bars.push({ bar, voices });
      }
      const built = clipTrack(score, trackId, bars);
      return built ? [built] : [];
    });
    if (
      tracks.length === 0 ||
      tracks.every(({ bars }) => bars.every((b) => b.voices.every((v) => v.beats.length === 0)))
    ) {
      return { refused: NOTHING };
    }
    return { clip: finish(range.kind, tracks) };
  }
  const at = cursor && resolveCursor(score, cursor);
  const track = at && score.tracks[at.track];
  const beat = at && track?.bars[at.bar]?.voices[at.voice]?.beats[at.stop];
  if (!at || !track || !beat) return { refused: NOTHING };
  const built = clipTrack(score, track.id, [
    { bar: at.bar, voices: [{ voice: at.voice, offset: 0, beats: [beat] }] },
  ]);
  return built ? { clip: finish('beats', [built]) } : { refused: NOTHING };
}

const voiceless = (voice: number): ClipVoice => ({ voice, offset: 0, beats: [] });

function finish(kind: Clip['kind'], tracks: ClipTrack[]): Clip {
  return {
    version: CLIPBOARD_VERSION,
    kind,
    tracks: tracks.map((track) => {
      const bars = releaseOrphanTies(track.bars);
      return { ...track, bars: kind === 'beats' ? alignSingleVoice(bars) : bars };
    }),
  };
}

/**
 * The beats a cut takes out: a beats or bars range, else the beat under the cursor, as one
 * splice per (track, bar, voice). The bars stay, emptied or left unfilled.
 */
export function planCut(
  score: Score,
  state: CopyState,
  visible?: readonly Id[],
): { command: Command; kind: Clip['kind'] } | Refused {
  const { range, cursor } = state;
  let parts: RangeVoice[] = [];
  if (range) {
    parts = rangeBeats(score, range, visible);
  } else {
    const at = cursor && resolveCursor(score, cursor);
    const track = at && score.tracks[at.track];
    const beat = at && track?.bars[at.bar]?.voices[at.voice]?.beats[at.stop];
    if (at && track && beat) {
      parts = [{ track: track.id, bar: at.bar, voice: at.voice, beats: [beat] }];
    }
  }
  const edits = parts.flatMap((part) => {
    const voice = score.tracks.find(({ id }) => id === part.track)?.bars[part.bar]?.voices[
      part.voice
    ];
    const first = part.beats[0];
    const index = first && voice ? voice.beats.indexOf(first) : -1;
    return voice && index >= 0
      ? [{ voiceId: voice.id, index, remove: part.beats.length, beats: [] as Beat[] }]
      : [];
  });
  if (edits.length === 0) return { refused: NOTHING.replace('copy', 'cut') };
  const kind = range?.kind ?? 'beats';
  return {
    command: chain(kind === 'bars' ? 'cutBars' : 'cutBeats', [replaceBeats(edits)]),
    kind,
  };
}
