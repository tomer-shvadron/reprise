/** Length in code points, the unit line widths are counted in. */
export function length(text: string): number {
  // Code points on purpose: this is the unit a line width is counted in.
  // eslint-disable-next-line @typescript-eslint/no-misused-spread
  return [...text].length;
}

/** User text on one line: breaks and tabs become spaces. */
export function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

/** A row of characters that text is written onto by column, for the lines above and below the tab. */
export class Row {
  readonly #cells: string[] = [];

  put(column: number, text: string): void {
    let at = column;
    for (const char of text) {
      while (this.#cells.length < at) this.#cells.push(' ');
      this.#cells[at] = char;
      at++;
    }
  }

  get empty(): boolean {
    return this.#cells.every((cell) => cell === ' ');
  }

  toString(): string {
    return this.#cells.join('').trimEnd();
  }
}
