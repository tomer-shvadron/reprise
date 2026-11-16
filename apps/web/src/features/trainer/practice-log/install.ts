import type { AppServices } from '@/app/services';

import { startPracticeCapture, type CaptureServices } from './capture';
import {
  createPracticeRepository,
  type PracticeRepository,
  type PracticeTable,
} from './repository';

const repositories = new WeakMap<object, PracticeRepository>();

/** The practice log's repository of these services; undefined until `installPracticeLog` ran. */
export function practiceLogFor(services: Pick<AppServices, 'practice'>) {
  return repositories.get(services.practice);
}

/**
 * Starts logging practice into `table`, which the shell takes from the library database so this
 * feature never imports library internals. Returns the cleanup, which stores a running session.
 */
export function installPracticeLog(services: CaptureServices, table: PracticeTable): () => void {
  const repo = createPracticeRepository(table);
  repositories.set(services.practice, repo);
  const capture = startPracticeCapture(services, repo);
  return () => {
    void capture.stop();
  };
}
