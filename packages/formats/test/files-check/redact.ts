/**
 * A differing value as a report may show it. A local file's text (a title, a track name, a
 * lyric, a chord name) never leaves its tab, so only numbers, booleans and absences survive.
 */
export function shownValue(value: unknown, local: boolean): string {
  if (value === undefined) return 'undefined';
  if (!local || value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  return '<text>';
}
