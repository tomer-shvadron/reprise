/** jsdom keeps no scroll position; give an element writable `scrollLeft` and `scrollTop`. */
export function stubScroll(element: Element): void {
  for (const key of ['scrollLeft', 'scrollTop']) {
    let value = 0;
    Object.defineProperty(element, key, {
      configurable: true,
      get: () => value,
      set: (next: number) => {
        value = next;
      },
    });
  }
}
