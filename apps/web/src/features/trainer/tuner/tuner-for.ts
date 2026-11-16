import { createTuner, type TunerDeps, type TunerServices, type TunerStore } from './tuner-store';

const tuners = new WeakMap<object, TunerStore>();

/**
 * The tuner of these services, made once: the panel and the command share it. `deps` only
 * matters on the first call for a platform, which tests use to inject a fake microphone.
 */
export function tunerFor(services: TunerServices, deps?: TunerDeps): TunerStore {
  let tuner = tuners.get(services.platform);
  if (!tuner) {
    tuner = createTuner(services, deps);
    tuners.set(services.platform, tuner);
  }
  return tuner;
}
