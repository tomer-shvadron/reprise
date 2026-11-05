import { beatTicks, type Track } from '@reprise/model';

import { glyphMetrics, textWidth } from '../metrics';
import { rect, type LayoutSink } from '../primitives';
import type { StaffType } from '../types';
import type {
  OnsetExtent,
  StaffBar,
  StaffBarMeasure,
  StaffBarPlacement,
  StaffGeometry,
  StaffModule,
} from './staff-module';

/** Tab lines sit wider apart than a standard staff's so fret numbers fit between them. */
export const TAB_LINE_SPACING = 1.5;
/** Fret numbers' font size, in staff spaces. */
export const FRET_TEXT_SIZE = 1.3;

/**
 * Half the width an onset reserves on each side: a two-digit fret number on tab, a note head on
 * the five-line staves. Stands in for the real content WP-021 and WP-023 draw.
 */
function halfWidth(type: StaffType, space: number): number {
  if (type === 'tab') return textWidth('00', FRET_TEXT_SIZE * space) / 2 + space * 0.25;
  const { left, right } = glyphMetrics('noteheadBlack').bbox;
  return ((right - left) / 2 + 0.25) * space;
}

function geometry(type: StaffType, track: Track, space: number): StaffGeometry {
  return type === 'tab'
    ? { lines: track.tuning.length, lineSpacing: TAB_LINE_SPACING * space }
    : { lines: 5, lineSpacing: space };
}

/** Each voice's beats with their onsets, in ticks from the bar start. */
function* voiceBeats(input: StaffBar) {
  for (const [voice, { beats }] of input.bar.voices.entries()) {
    let tick = 0;
    for (const beat of beats) {
      yield { voice, beat, tick };
      tick += beatTicks(beat);
    }
  }
}

/**
 * A staff module that measures beats by their duration alone and draws nothing but their
 * anchors, until the tab (WP-021) and standard and drum (WP-023) modules replace it.
 */
export function placeholderModule(type: StaffType): StaffModule {
  return {
    type,
    geometry: (track, space) => geometry(type, track, space),
    measure(input: StaffBar): StaffBarMeasure {
      const half = halfWidth(type, input.space);
      const onsets: OnsetExtent[] = [];
      for (const { tick } of voiceBeats(input)) onsets.push({ tick, left: half, right: half });
      return { onsets, above: input.space * 2, below: input.space * 2 };
    },
    render(input: StaffBar, placement: StaffBarPlacement, sink: LayoutSink): void {
      const half = halfWidth(type, input.space);
      const reach = input.space;
      for (const { voice, beat, tick } of voiceBeats(input)) {
        const x = placement.onsetX(tick);
        sink.anchors.push({
          kind: 'beat',
          id: beat.id,
          bbox: rect(
            x - half,
            placement.top - reach,
            half * 2,
            placement.bottom - placement.top + reach * 2,
          ),
          system: placement.system,
          track: input.track.id,
          staff: type,
          voice,
          masterBar: input.masterBar.id,
        });
      }
    },
  };
}
