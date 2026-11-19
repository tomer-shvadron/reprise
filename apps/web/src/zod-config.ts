import { z } from 'zod';

// Zod would probe `new Function('')` once to pick its fast parse path, and the CSP (no
// 'unsafe-eval') reports that probe as a violation even though zod catches the throw. Jitless
// skips the probe. Import this first in every entry point (main thread and workers), before any
// module builds a schema, because the choice is read when a schema is created.
z.config({ jitless: true });
