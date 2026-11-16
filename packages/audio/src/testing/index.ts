// Test-only: lint lets only test files import @reprise/audio/testing.
export { debugAudioEngine } from '../engine';
export type { AudioEngineDebug } from '../engine';
export { encodeFlac, encodeWav } from '../sfz/test/encode';
export type { BitDepth } from '../sfz/test/encode';
export { syntheticSfzPack } from './synthetic-pack';
export type { SyntheticSfzPack, SyntheticSfzPackOptions } from './synthetic-pack';
export {
  GUITAR_RELEASE_DECAY,
  GUITAR_ROOT_KEY,
  GUITAR_TONES,
  syntheticGuitarPack,
} from './synthetic-guitar-pack';
export type { SyntheticGuitarPack, SyntheticGuitarPackOptions } from './synthetic-guitar-pack';
