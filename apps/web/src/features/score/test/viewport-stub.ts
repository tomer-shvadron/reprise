import { vi } from 'vitest';

/** jsdom lays nothing out; give every element the scroll container's client size. */
export function stubViewport(width: number, height: number): void {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(height);
}
