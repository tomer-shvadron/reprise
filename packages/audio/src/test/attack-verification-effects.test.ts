/** The knockout case of attack-verification.test.ts for one fixture, in its own file to run in parallel. */
import { describe } from 'vitest';

import { generalUser, knockoutCase } from './attack-verification-support';

describe.skipIf(!generalUser)('attack verification on the fixtures', () => {
  knockoutCase('gp5/effects.gp5');
});
