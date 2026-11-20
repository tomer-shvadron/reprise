import { defaultFilter } from 'cmdk';
import { memo, useEffect, useMemo } from 'react';
import { useStore } from 'zustand';

import { CommandEmpty, CommandGroup, CommandItem, CommandShortcut } from '@/components/ui/command';
import { libraryOf, rankSongs, SONG_LIMIT } from '@/features/library';
import { rankTracks, trackEntries } from '@/features/tracks';
import { playheadBar, rankSections, sectionBars, sectionsOf } from '@/features/transport';

import { runCommand, type CommandRegistry } from '../command-registry';
import { formatShortcut, shortcutOn, type KeyboardPlatform } from '../keyboard';
import type { AppServices } from '../services';
import { goToBar, goToSection, loopBars, openSong, pickTrack, showOnlyTrack } from './actions';
import { barRow } from './bars';
import type { PaletteMode, PaletteRow } from './types';

/** What a prefix mode tells the palette body: the rows to act on, and a note for the footer. */
export interface ModeReport {
  /** The mode these rows were built for, so the body never reads the previous mode's rows as the new one's. */
  mode: PaletteMode;
  rows: PaletteRow[];
  note?: string;
  /** The text shown when there are no rows, also announced. */
  empty?: string;
}

interface ModeProps {
  services: AppServices;
  text: string;
  keyboard: KeyboardPlatform;
  /** The selected row's value, so only it shows its alternate action. */
  selected: string;
  close: () => void;
  report: (report: ModeReport) => void;
}

/** Reports to the body while mounted, so the footer, ⌘↩ and the live region see these rows. */
function useReport(
  report: ModeProps['report'],
  mode: PaletteMode,
  value: Omit<ModeReport, 'mode'>,
): void {
  const { rows, note, empty } = value;
  useEffect(() => {
    report({
      mode,
      rows,
      ...(note === undefined ? {} : { note }),
      ...(empty === undefined ? {} : { empty }),
    });
    return () => {
      report({ mode, rows: [] });
    };
  }, [report, mode, rows, note, empty]);
}

function Rows({
  heading,
  rows,
  empty,
  selected,
  keyboard,
  close,
  children,
}: {
  heading: string;
  rows: PaletteRow[];
  empty: string | undefined;
  selected: string;
  keyboard: KeyboardPlatform;
  close: () => void;
  children?: React.ReactNode;
}) {
  const altKeys = formatShortcut({ key: 'Enter', mod: true }, keyboard);
  return (
    <>
      {rows.length === 0 && empty !== undefined && <CommandEmpty>{empty}</CommandEmpty>}
      {rows.length > 0 && (
        <CommandGroup heading={heading}>
          {rows.map((row) => (
            <CommandItem
              key={row.value}
              value={row.value}
              aria-label={row.spoken}
              onSelect={() => {
                close();
                row.run();
              }}
            >
              <span>{row.label}</span>
              {row.detail !== undefined && (
                <span className="text-muted-foreground group-data-selected/command-item:text-foreground text-xs">
                  {row.detail}
                </span>
              )}
              {row.tag !== undefined && (
                <span className="bg-muted text-foreground group-data-selected/command-item:bg-background rounded px-1.5 text-[10px]">
                  {row.tag}
                </span>
              )}
              {row.alt && row.value === selected && (
                <CommandShortcut>{`${altKeys} ${row.alt.label}`}</CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {children}
    </>
  );
}

const spokenRange = (start: number, end: number) =>
  start === end ? `bar ${String(start)}` : `bars ${String(start)} to ${String(end)}`;

export function SectionRows(props: ModeProps) {
  const { services, text, selected, keyboard, close, report } = props;
  const score = useStore(services.document, (state) => state.score);
  // Read once, never subscribed to: the tag is for the moment the palette opens.
  const playing = useMemo(() => {
    const id = playheadBar(services);
    const index = score?.masterBars.findIndex((bar) => bar.id === id);
    return index === undefined || index < 0 ? undefined : index;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);
  const { rows, empty } = useMemo(() => {
    if (!score) return { rows: [], empty: 'Open a song to jump to its sections.' };
    const all = sectionsOf(score);
    if (all.length === 0) {
      return {
        rows: [],
        empty: 'This song has no section markers. Type a bar number instead.',
      };
    }
    const ranked = rankSections(all, text, playing);
    const built = ranked.map(({ section, tag }): PaletteRow => {
      const spoken = `${section.label}, ${spokenRange(section.startBar, section.endBar)}${tag ? `, ${tag.toLowerCase()}` : ''}`;
      return {
        value: `section:${String(section.startIndex)}`,
        label: section.label,
        detail: sectionBars(section),
        ...(tag === undefined ? {} : { tag }),
        spoken,
        run: () => {
          goToSection(services, section);
        },
        alt: {
          label: 'Loop',
          run: () => {
            loopBars(services, section.startIndex, section.endIndex, section.label);
          },
        },
      };
    });
    return {
      rows: built,
      ...(built.length === 0 ? { empty: `No section matches “${text}”.` } : {}),
    };
  }, [score, text, playing, services]);
  useReport(report, 'sections', { rows, ...(empty === undefined ? {} : { empty }) });
  return <Rows heading="Sections" {...{ rows, empty, selected, keyboard, close }} />;
}

export function TrackRows(props: ModeProps) {
  const { services, text, selected, keyboard, close, report } = props;
  const score = useStore(services.document, (state) => state.score);
  const view = useStore(services.document, (state) => state.view.tracks);
  const current = useStore(services.selection, (state) => state.currentTrack);
  const { rows, empty } = useMemo(() => {
    if (!score) return { rows: [], empty: 'Open a song to pick a track.' };
    const ranked = rankTracks(trackEntries(score, view, current), text);
    const built = ranked.map((entry): PaletteRow => {
      const tag = entry.current ? 'Current' : entry.hidden ? 'Hidden' : undefined;
      return {
        value: `track:${entry.id}`,
        label: `${String(entry.number)} · ${entry.label}`,
        detail: entry.instrument,
        ...(tag === undefined ? {} : { tag }),
        spoken: `Track ${String(entry.number)}, ${entry.label}, ${entry.instrument}${tag ? `, ${tag.toLowerCase()}` : ''}`,
        run: () => {
          pickTrack(services, entry.id);
        },
        alt: {
          label: 'Show only this track',
          run: () => {
            showOnlyTrack(services, entry.id);
          },
        },
      };
    });
    return {
      rows: built,
      ...(built.length === 0 ? { empty: `No track matches “${text}”.` } : {}),
    };
  }, [score, view, current, text, services]);
  useReport(report, 'tracks', { rows, ...(empty === undefined ? {} : { empty }) });
  return <Rows heading="Tracks" {...{ rows, empty, selected, keyboard, close }} />;
}

/** The two rows that bring in a song the library does not hold. */
function importRows(registry: CommandRegistry, close: () => void): PaletteRow[] {
  const wanted: { id: string; label: string }[] = [
    { id: 'file.open', label: 'Open file…' },
    { id: 'library.importFiles', label: 'Import files to library…' },
  ];
  return wanted.flatMap(({ id, label }) => {
    const command = registry.get(id);
    if (!command) return [];
    return [
      {
        value: `command:${command.id}`,
        label,
        run: () => {
          close();
          runCommand(command);
        },
      },
    ];
  });
}

export function SongRows(props: ModeProps & { registry: CommandRegistry }) {
  const { services, text, selected, keyboard, close, report, registry } = props;
  const store = libraryOf(services).store;
  const entries = useStore(store, (state) => state.entries);
  const loaded = useStore(store, (state) => state.loaded);
  const error = useStore(store, (state) => state.error);
  const openId = useStore(services.document, (state) => state.songId);
  const { rows, empty, note } = useMemo((): Omit<ModeReport, 'mode'> => {
    if (!loaded) return { rows: [], empty: 'Loading the library…' };
    if (error !== undefined) return { rows: [], empty: error };
    const ranked = rankSongs(entries, text, openId);
    const built = ranked.rows.map((song): PaletteRow => ({
      value: `song:${song.id}`,
      label: song.label,
      ...(song.detail === '' ? {} : { detail: song.detail }),
      ...(song.open ? { tag: 'Open' } : {}),
      spoken: `${song.label}${song.detail === '' ? '' : `, ${song.detail}`}${song.open ? ', open' : ''}`,
      run: () => {
        openSong(services, song.id);
      },
    }));
    if (built.length > 0) {
      return {
        rows: built,
        ...(ranked.total > SONG_LIMIT
          ? {
              note: `Showing ${String(SONG_LIMIT)} of ${ranked.total.toLocaleString('en-US')}. Keep typing.`,
            }
          : {}),
      };
    }
    const message =
      entries.length === 0
        ? 'Your library is empty.'
        : `No song in your library matches “${text}”.`;
    return { rows: importRows(registry, close), empty: message };
  }, [loaded, error, entries, text, openId, services, registry, close]);
  useReport(report, 'songs', {
    rows,
    ...(empty === undefined ? {} : { empty }),
    ...(note === undefined ? {} : { note }),
  });
  return (
    <Rows heading="Library" {...{ rows, selected, keyboard, close }} empty={undefined}>
      {empty !== undefined && (
        <p role="presentation" className="text-muted-foreground px-3 py-2 text-center text-sm">
          {empty}
        </p>
      )}
    </Rows>
  );
}

export function BarRows(props: ModeProps) {
  const { services, text, selected, keyboard, close, report } = props;
  const score = useStore(services.document, (state) => state.score);
  const { rows, empty } = useMemo(() => {
    if (text === '') {
      const total = score?.masterBars.length;
      return {
        rows: [],
        empty:
          total === undefined
            ? 'Open a song to go to a bar.'
            : `Type a bar number, 1 to ${String(total)}.`,
      };
    }
    const result = barRow(score, text);
    if (result.kind === 'message') return { rows: [], empty: result.message };
    return {
      rows: [
        {
          value: `bar:${String(result.index + 1)}`,
          label: result.label,
          ...(result.detail === undefined ? {} : { detail: result.detail }),
          spoken: `${result.label}${result.detail === undefined ? '' : `, ${result.detail}`}`,
          run: () => {
            goToBar(services, result.index);
          },
          alt: {
            label: 'Loop',
            run: () => {
              loopBars(services, result.index, result.index, `bar ${String(result.index + 1)}`);
            },
          },
        } satisfies PaletteRow,
      ],
      empty: undefined,
    };
  }, [score, text, services]);
  useReport(report, 'bar', { rows, ...(empty === undefined ? {} : { empty }) });
  return <Rows heading="Bar" {...{ rows, empty, selected, keyboard, close }} />;
}

/**
 * cmdk's fuzzy score, except that a title the search is the start of comes first: typing "Bar
 * properties" must reach that command before any looser match. The title is the item's first keyword.
 */
export function rank(value: string, search: string, keywords?: string[]): number {
  const title = keywords?.[0]?.toLowerCase() ?? '';
  const wanted = search.trim().toLowerCase();
  if (wanted !== '' && title.startsWith(wanted)) return 2;
  return defaultFilter(value, search, keywords);
}

export const CommandRows = memo(function CommandRows({
  registry,
  keyboard,
  close,
}: {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
  close: () => void;
}) {
  const commands = registry.available().filter((command) => command.inPalette !== false);
  return (
    <>
      <CommandEmpty>No matching command.</CommandEmpty>
      <CommandGroup heading="Commands">
        {commands.map((command) => {
          const shortcut = registry.isShadowed(command)
            ? undefined
            : shortcutOn(registry.shortcutOf(command), keyboard);
          return (
            <CommandItem
              key={command.id}
              value={command.id}
              keywords={[command.searchTitle ?? command.title]}
              onSelect={() => {
                close();
                runCommand(command);
              }}
            >
              {command.title}
              {shortcut && <CommandShortcut>{formatShortcut(shortcut, keyboard)}</CommandShortcut>}
            </CommandItem>
          );
        })}
      </CommandGroup>
    </>
  );
});
