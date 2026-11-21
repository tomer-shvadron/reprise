import type { Notation, Track } from '@reprise/model';
import { cn } from 'cn';
import { memo, use, type ReactElement, type ReactNode } from 'react';

import { CommandTooltip, HintTooltip, ShortcutKeys } from '@/app/command-tooltip';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { spokenShortcut } from '@/app/keyboard';
import { CommandSourceContext } from '@/app/use-command';
import { instrumentName } from '@/lib/gm-programs';
import type { TrackActions } from './track-actions';
import {
  MuteToggle,
  NotationMenu,
  SoloToggle,
  TrackVolume,
  VisibilityToggle,
} from './track-controls';
import { goCommandId } from './commands';
import { TRACK_LIST_KEYS, TRACK_SELECT_ATTR } from './sidebar-focus';
import { trackLabel } from './track-model';

interface TrackRowProps {
  track: Track;
  index: number;
  muted: boolean;
  soloed: boolean;
  audible: boolean;
  current: boolean;
  visible: boolean;
  /** The only visible track, which cannot be hidden. */
  lastVisible: boolean;
  notation: Notation;
  /** Single-track view is on, which leaves the multitrack set alone. */
  single: boolean;
  loading: boolean;
  /** The one name button in the Tab order; the others take focus from the arrows. Default true. */
  tabStop?: boolean;
  actions: TrackActions;
  /** The app's menu for the row; see `TrackSidebar`. */
  rowMenu?: ((track: Track, index: number) => ReactNode) | undefined;
}

/**
 * The name button's tooltip: the jump key from the registry (rows 1 to 9 have one), then the
 * list's own M and S, read from the constant the key handler matches against.
 */
function NameTooltip({
  index,
  children,
}: {
  index: number;
  children: ReactElement<Record<string, unknown>>;
}) {
  const source = use(CommandSourceContext);
  if (!source) throw new Error('A track row needs a CommandSourceContext');
  const label = `Track ${String(index + 1)}`;
  const listKeys = (
    <span className="inline-flex items-center gap-1">
      <span>With the name focused:</span>
      <ShortcutKeys bindings={[TRACK_LIST_KEYS.mute]} platform={source.keyboard} />
      <span>mutes,</span>
      <ShortcutKeys bindings={[TRACK_LIST_KEYS.solo]} platform={source.keyboard} />
      <span>solos</span>
    </span>
  );
  const goId = goCommandId(index + 1);
  if (goId === undefined) return <HintTooltip label={listKeys}>{children}</HintTooltip>;
  return (
    <CommandTooltip
      command={goId}
      label={label}
      detail={{
        node: listKeys,
        spoken: `With the name focused: ${spokenShortcut(TRACK_LIST_KEYS.mute, source.keyboard)} mutes, ${spokenShortcut(TRACK_LIST_KEYS.solo, source.keyboard)} solos`,
      }}
    >
      {children}
    </CommandTooltip>
  );
}

export const TrackRow = memo(function TrackRow({
  track,
  index,
  muted,
  soloed,
  audible,
  current,
  visible,
  lastVisible,
  notation,
  single,
  loading,
  tabStop = true,
  actions,
  rowMenu,
}: TrackRowProps) {
  const label = trackLabel(track, index);
  const menu = useStaticContextMenu({
    surface: 'track.row',
    target: { kind: 'track', track: track.id },
    label: `Track ${label}`,
  });
  const disabledReason = single
    ? 'Turn on multitrack view to choose the tracks shown'
    : visible && lastVisible
      ? 'At least one track stays shown'
      : undefined;

  return (
    <li
      {...menu}
      data-audible={audible}
      className={cn(
        'flex gap-2 border-b px-2 py-1.5',
        current && 'bg-sidebar-accent text-sidebar-accent-foreground muted-on-accent',
        !audible && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className="w-1 shrink-0 rounded-full"
        style={{ backgroundColor: track.color }}
      />
      {/* The number the Alt+digit keys and the palette use; the name already says which track. */}
      <span
        aria-hidden
        data-track-number
        className="text-muted-foreground w-3 shrink-0 pt-0.5 text-right text-xs tabular-nums"
      >
        {index + 1}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <NameTooltip index={index}>
            <button
              type="button"
              aria-current={current ? 'true' : undefined}
              tabIndex={tabStop ? 0 : -1}
              {...{ [TRACK_SELECT_ATTR]: track.id }}
              className="min-w-0 flex-1 truncate text-left text-sm"
              onClick={() => {
                actions.selectTrack(track.id);
              }}
            >
              <span className="block truncate font-medium">{label}</span>
              <span className="text-muted-foreground block truncate text-xs">
                {loading ? 'Loading…' : instrumentName(track)}
              </span>
            </button>
          </NameTooltip>
          <VisibilityToggle
            id={track.id}
            label={label}
            visible={visible}
            disabledReason={disabledReason}
            actions={actions}
          />
          {rowMenu?.(track, index)}
        </div>
        <div className="flex items-center gap-1">
          <MuteToggle id={track.id} label={label} pressed={muted} actions={actions} />
          <SoloToggle id={track.id} label={label} pressed={soloed} actions={actions} />
          <NotationMenu track={track} label={label} notation={notation} actions={actions} />
          <TrackVolume
            id={track.id}
            label={label}
            volume={track.channel.volume}
            actions={actions}
            compact
          />
        </div>
      </div>
    </li>
  );
});
