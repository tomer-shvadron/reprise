import type { SongInsights } from '@/lib/insights';

import { InsightCard } from './card';

export function KeyChangesCard({ changes }: { changes: SongInsights['keyChanges'] }) {
  if (changes.length === 0) return null;
  return (
    <InsightCard title="Key changes" data-insight-card="key-changes">
      <ul className="flex flex-col gap-0.5 text-sm">
        {changes.map((change) => (
          <li key={change.fromBar}>
            Bars {String(change.fromBar + 1)}–{String(change.toBar + 1)}: {change.name} (
            {change.relation})
          </li>
        ))}
      </ul>
    </InsightCard>
  );
}
