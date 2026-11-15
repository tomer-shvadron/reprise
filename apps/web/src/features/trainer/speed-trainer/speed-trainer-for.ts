import {
  createSpeedTrainer,
  type SpeedTrainerServices,
  type SpeedTrainerStore,
} from './speed-trainer-store';

const trainers = new WeakMap<object, SpeedTrainerStore>();

/**
 * The speed trainer of these services, made once: the panel and the commands share it, and a
 * run goes on while the panel is hidden because the store lives outside React.
 */
export function speedTrainerFor(services: SpeedTrainerServices): SpeedTrainerStore {
  let trainer = trainers.get(services.playback);
  if (!trainer) {
    trainer = createSpeedTrainer(services);
    trainers.set(services.playback, trainer);
  }
  return trainer;
}
