import { Placeholder } from '@/components/placeholder';

import { EffectsDemo } from './effects-demo';

/**
 * WP-091 replaces the placeholder with the pack list, licences, downloads and the memory readout
 * of WP-094; the effects demo stays until the per-track sound control it feeds has a home.
 */
export function SoundManager() {
  return (
    <Placeholder title="Sounds" workPackage="WP-091">
      <div className="mt-3 max-w-lg">
        <EffectsDemo />
      </div>
    </Placeholder>
  );
}
