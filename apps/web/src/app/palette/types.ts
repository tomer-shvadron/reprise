export type PaletteMode = 'commands' | 'sections' | 'tracks' | 'songs' | 'bar';

/** One list item of a prefix mode. Providers rank; the palette body binds `run` and `alt`. */
export interface PaletteRow {
  /** Unique cmdk value: `section:<index>`, `track:<id>`, `song:<id>`, `bar:<n>`. */
  value: string;
  label: string;
  /** Muted second part: "Bars 17–24", "Distortion guitar". */
  detail?: string;
  /** Short badge: "Playing", "Current", "Open", "Hidden". */
  tag?: string;
  /** The spoken name when the visual one holds an en dash or a symbol. */
  spoken?: string;
  run: () => void;
  /** The Cmd+Enter action, named in the footer. */
  alt?: { label: string; run: () => void };
}
