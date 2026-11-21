import { LayersIcon } from 'lucide-react';
import type { Track } from '@reprise/model';
import { use, useId, useMemo, type KeyboardEvent, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { CommandRegistry } from '@/app/command-registry';
import { matchesShortcut, type KeyboardPlatform } from '@/app/keyboard';
import { useAppServices } from '@/app/services-context';
import { bindCommand, CommandSourceContext, useCommand, useCommandSource } from '@/app/use-command';
import { Toggle } from '@/components/ui/toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { singleTrackOf } from '@/state/document';

import { TRACK_LIST_ATTR, TRACK_SELECT_ATTR } from './sidebar-focus';
import { goCommandId } from './commands';
import { useTrackActions } from './track-actions';
import { TrackRow } from './track-row';
import { audibleTracks, effectiveMix, effectiveNotation, visibleSet } from './track-model';

/** What the app adds to the sidebar without this folder importing the editor. */
interface TrackSidebarSlots {
  /** Next to the multitrack toggle, e.g. the add-track button. */
  headerActions?: ReactNode;
  /** A row's menu, at the end of its first line; a stable function, so rows stay memoised. */
  rowMenu?: ((track: Track, index: number) => ReactNode) | undefined;
}

interface TrackSidebarProps extends TrackSidebarSlots {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
}

function MultitrackToggle({ single, disabled }: { single: boolean; disabled: boolean }) {
  const command = useCommand('view.toggleMultitrack');
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Toggle
          size="sm"
          aria-label="Multitrack view"
          aria-keyshortcuts={command.ariaKeys}
          pressed={!single}
          disabled={disabled}
          onPressedChange={command.run}
        >
          <LayersIcon />
        </Toggle>
      </TooltipTrigger>
      <TooltipContent>
        Multitrack view{command.keys !== undefined && ` (${command.keys})`}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Keys for a row's name button, which holds the focus when the list is entered (it is the list's
 * one tab stop among the names; each row's other controls stay in the tab order): the arrows move
 * between rows (Enter selects, as the button does anyway), M and S mute and solo that row. A key
 * on any other control of the row, a slider or a menu, stays with that control.
 */
function listKeysHandler(actions: ReturnType<typeof useTrackActions>, keyboard: KeyboardPlatform) {
  return (event: KeyboardEvent<HTMLUListElement>) => {
    const { target } = event;
    if (!(target instanceof HTMLElement)) return;
    const id = target.getAttribute(TRACK_SELECT_ATTR);
    if (id === null || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(`[${TRACK_SELECT_ATTR}]`),
    ];
    const at = buttons.indexOf(target);
    const move = (to: HTMLElement | undefined) => {
      event.preventDefault();
      to?.focus();
    };
    // M and S go through the registry's matcher, so a Hebrew or Russian layout (the physical key)
    // works and the key never falls through to a bare-letter command on the score.
    const letter = (key: string) => matchesShortcut(event.nativeEvent, { key }, keyboard);
    if (letter('m')) {
      event.preventDefault();
      event.stopPropagation();
      actions.toggleMute(id);
      return;
    }
    if (letter('s')) {
      event.preventDefault();
      event.stopPropagation();
      actions.toggleSolo(id);
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        move(buttons[Math.min(at + 1, buttons.length - 1)]);
        break;
      case 'ArrowUp':
        move(buttons[Math.max(at - 1, 0)]);
        break;
      case 'Home':
        move(buttons[0]);
        break;
      case 'End':
        move(buttons[buttons.length - 1]);
        break;
    }
  };
}

function TrackList({ headerActions, rowMenu }: TrackSidebarSlots) {
  const { document, selection, playback } = useAppServices();
  const actions = useTrackActions();
  const score = useStore(document, (state) => state.score);
  const view = useStore(document, (state) => state.view);
  const opening = useStore(document, (state) => state.opening);
  const currentTrack = useStore(selection, (state) => state.currentTrack);
  const mixer = useStore(playback, (state) => state.mixer);
  const loads = useStore(playback, (state) => state.instrumentLoads);
  const source = use(CommandSourceContext);
  if (!source) throw new Error('TrackList needs a CommandSourceContext');
  const onKeyDown = listKeysHandler(actions, source.keyboard);
  const headingId = useId();
  const tracks = score?.tracks;
  const audible = useMemo(() => tracks && audibleTracks(tracks, mixer), [tracks, mixer]);
  const shown = useMemo(() => tracks && visibleSet(tracks, view.tracks), [tracks, view.tracks]);
  const single = singleTrackOf(view, score) !== undefined;

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 py-1">
        <h2
          id={headingId}
          className="text-muted-foreground text-xs font-medium tracking-wide uppercase"
        >
          Tracks
        </h2>
        <div className="flex items-center gap-0.5">
          {headerActions}
          <MultitrackToggle single={single} disabled={!score} />
        </div>
      </div>
      {!tracks || !audible || !shown ? (
        <p className="text-muted-foreground px-3 py-2 text-sm">
          {opening === undefined ? 'No file open.' : `Opening ${opening}…`}
        </p>
      ) : (
        <ul
          aria-labelledby={headingId}
          {...{ [TRACK_LIST_ATTR]: '' }}
          className="min-h-0 flex-1 overflow-y-auto border-t"
          onKeyDown={onKeyDown}
        >
          {tracks.map((track, index) => {
            const mix = effectiveMix(track, mixer[track.id]);
            const visible = shown.has(track.id);
            const goId = goCommandId(index + 1);
            const jump = goId && bindCommand(source, goId);
            return (
              <TrackRow
                key={track.id}
                track={track}
                index={index}
                muted={mix.mute}
                soloed={mix.solo}
                audible={audible.has(track.id)}
                current={track.id === currentTrack}
                visible={visible}
                lastVisible={shown.size === 1}
                notation={effectiveNotation(track, view.notation)}
                single={single}
                loading={loads[track.id] !== undefined}
                jumpKeys={jump?.keys}
                jumpAriaKeys={jump?.ariaKeys}
                tabStop={track.id === (currentTrack ?? tracks[0]?.id)}
                actions={actions}
                rowMenu={rowMenu}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** The left sidebar: every track with its mute, solo, volume, notation and visibility. */
export function TrackSidebar({ registry, keyboard, headerActions, rowMenu }: TrackSidebarProps) {
  const { settings, editing } = useAppServices();
  const source = useCommandSource(registry, keyboard, settings, editing);
  return (
    <CommandSourceContext value={source}>
      <TrackList headerActions={headerActions} rowMenu={rowMenu} />
    </CommandSourceContext>
  );
}
