/**
 * A voice's shift as drawn. The shift is rigid room, and a bar too dense for its line draws all
 * its rigid room at `rigidScale`, so the shift is scaled with it.
 */
export function drawnShift(
  beat: { readonly shift?: number } | undefined,
  rigidScale: number,
): number {
  return (beat?.shift ?? 0) * rigidScale;
}
