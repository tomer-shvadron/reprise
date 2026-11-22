/** The score's region, where focus goes when the control that had it goes away. */
export const scoreRegion = () =>
  globalThis.document.querySelector<HTMLElement>('[role="region"][aria-roledescription="score"]') ??
  globalThis.document.querySelector<HTMLElement>('main');
