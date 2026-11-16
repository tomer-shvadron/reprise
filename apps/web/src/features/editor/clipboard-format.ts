import { BeatSchema, TimeSignatureSchema, TrackKindSchema } from '@reprise/model';
import { z } from 'zod';

/** The version in the first line of the clipboard text and in the clip itself. */
export const CLIPBOARD_VERSION = 1;

const HEADER = `Reprise clipboard ${String(CLIPBOARD_VERSION)}`;

/** A bigger payload is not a clip: it would be megabytes of someone else's text. */
export const MAX_CLIPBOARD_CHARS = 8_000_000;

/** One voice of one bar of the clip. `offset` is where its first beat starts, in ticks. */
export const ClipVoiceSchema = z.object({
  voice: z.int().min(0).max(3),
  offset: z.number().min(0),
  beats: z.array(BeatSchema),
});
export type ClipVoice = z.infer<typeof ClipVoiceSchema>;

/**
 * The k-th bar the copied range touches. For a beats clip `offset` counts from the range's start
 * in the first bar and from the bar's start after that; a bars clip records all four voices,
 * the empty ones too, so pasting over a bar clears the voices the clip does not have.
 */
export const ClipBarSchema = z.object({
  timeSignature: TimeSignatureSchema,
  voices: z.array(ClipVoiceSchema),
});
export type ClipBar = z.infer<typeof ClipBarSchema>;

export const ClipTrackSchema = z.object({
  kind: TrackKindSchema,
  tuning: z.array(z.int().min(0).max(127)),
  fretCount: z.int().min(0),
  /** Frets count from the capo, as the model's `midiNote` does, so a re-fingering needs it. */
  capo: z.int().min(0).default(0),
  name: z.string(),
  bars: z.array(ClipBarSchema),
});
export type ClipTrack = z.infer<typeof ClipTrackSchema>;

/**
 * What a copy keeps: beats or whole bars, per track, in score order. The ids inside are kept so
 * the schema validates but are never reused: a paste gives everything a fresh id.
 */
export const ClipSchema = z.object({
  version: z.literal(CLIPBOARD_VERSION),
  kind: z.enum(['beats', 'bars']),
  /**
   * Ticks into the first bar where a beats clip started. A clip over a barline pastes only at the
   * same position in its bar, or its later bars would land around the target's own beats.
   */
  start: z.number().min(0).default(0),
  tracks: z.array(ClipTrackSchema).min(1),
});
export type Clip = z.infer<typeof ClipSchema>;

/** The text that goes on the system clipboard: a versioned header line, then the clip as JSON. */
export function serializeClip(clip: Clip): string {
  return `${HEADER}\n${JSON.stringify(clip)}`;
}

/** The clip in `text`, or undefined when it is not one: foreign text, another version, bad JSON or too big. */
export function parseClip(text: string): Clip | undefined {
  // A clipboard that went through another app or Windows may have CRLF line ends.
  const header = text.startsWith(`${HEADER}\r\n`) ? HEADER.length + 2 : HEADER.length + 1;
  if (
    text.length > MAX_CLIPBOARD_CHARS ||
    !text.startsWith(HEADER) ||
    !/^\r?\n/.test(text.slice(HEADER.length, HEADER.length + 2))
  ) {
    return undefined;
  }
  let json: unknown;
  try {
    json = JSON.parse(text.slice(header));
  } catch {
    return undefined;
  }
  const parsed = ClipSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}
