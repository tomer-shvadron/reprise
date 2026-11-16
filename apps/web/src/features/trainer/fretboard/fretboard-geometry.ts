import { fretPosition, type BoardShape } from './fretboard-model';

const NUT_X = 56;
const BOARD_WIDTH = 1200;
const STRING_GAP = 26;
const TOP = 14;
/** How far the nut, the fret wires and the capo reach past the outer strings. */
const OVERHANG = 8;

export interface Geometry {
  width: number;
  height: number;
  /** x of the dot for an absolute fret: between its two fret wires, left of the nut for 0. */
  dotX: (absolute: number) => number;
  lineX: (fret: number) => number;
  /** Where the open-string names sit, left of the nut (right of it when flipped). */
  nameX: number;
  stringY: (string: number) => number;
  /** The vertical extent of the nut, the fret wires and the capo. */
  wireTop: number;
  wireBottom: number;
  stringGap: number;
}

export function geometryOf(board: BoardShape, leftHanded: boolean): Geometry {
  const span = BOARD_WIDTH - NUT_X - 8;
  const wire = (fret: number) => NUT_X + fretPosition(fret, board.frets) * span;
  const flip = (x: number) => (leftHanded ? BOARD_WIDTH - x : x);
  const stringY = (string: number) => TOP + (string - 1) * STRING_GAP;
  return {
    width: BOARD_WIDTH,
    height: TOP * 2 + (board.strings - 1) * STRING_GAP + 22,
    lineX: (fret) => flip(wire(fret)),
    dotX: (absolute) =>
      flip(absolute <= 0 ? NUT_X - 18 : (wire(absolute - 1) + wire(absolute)) / 2),
    nameX: flip(12),
    stringY,
    wireTop: stringY(1) - OVERHANG,
    wireBottom: stringY(board.strings) + OVERHANG,
    stringGap: STRING_GAP,
  };
}
