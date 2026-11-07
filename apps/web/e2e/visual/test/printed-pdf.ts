/** What the visual suite's `printPdf` command reports, shared by its Node and browser sides. */
export interface PageGeometry {
  top: number;
  width: number;
  height: number;
  /** Whether every system box lies inside the page box. */
  systemsInside: boolean;
}

export interface PrintedPdf {
  domPages: number;
  geometry: PageGeometry[];
  pdfPages: number;
  mediaBoxes: [number, number][];
  pdfBytes: number;
  /** From navigation to the print container's first page: load, layout and mount. */
  readyMs: number;
  pdfMs: number;
  nodes: number;
  jsHeapBytes: number;
  path: string;
}
