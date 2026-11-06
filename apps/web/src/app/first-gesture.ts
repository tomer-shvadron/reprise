const GESTURES = ['pointerdown', 'keydown'] as const;

/**
 * Runs `onGesture` once, on the first pointer or key press anywhere: an AudioContext created
 * then starts running. A lone modifier key is not a Chrome activation, so a context made by one
 * starts suspended, and Play resumes it.
 */
export function installFirstGesture(target: Window, onGesture: () => void): () => void {
  const remove = () => {
    for (const type of GESTURES) target.removeEventListener(type, handle, true);
  };
  function handle() {
    remove();
    onGesture();
  }
  for (const type of GESTURES) target.addEventListener(type, handle, true);
  return remove;
}
