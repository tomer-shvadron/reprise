// Chromium's timer-driven fake audio output: realtime audio never touches the host's audio daemon,
// which can stall (coreaudiod on macOS) and freeze every AudioContext clock. A spec that sets its own
// `launchOptions` replaces the config's, so it must repeat this flag.
export const FAKE_AUDIO_OUTPUT = '--disable-audio-output';
