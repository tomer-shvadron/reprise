/**
 * A voice's shift as drawn. The shift is the movable part of the onset's rigid room: a bar too
 * dense for its line draws it at `rigidScale`, while the fixed part keeps its size.
 */
export function drawnShift(
  beat: { readonly shift?: number } | undefined,
  rigidScale: number,
): number {
  return (beat?.shift ?? 0) * rigidScale;
}
