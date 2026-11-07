const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number']);

/** An element with its own text editing and undo history. */
export function isTextField(target: EventTarget | null): boolean {
  if (target instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(target.type);
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

/** An element that handles bare keys itself: a text field, or a select, range or checkbox. */
export function isEditable(target: EventTarget | null): boolean {
  return (
    isTextField(target) || target instanceof HTMLInputElement || target instanceof HTMLSelectElement
  );
}
