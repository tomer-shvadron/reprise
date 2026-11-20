import { Fragment } from 'react';
import { useStore } from 'zustand';

import { StatusMenu, StatusSegment } from '@/app/status-bar/segment';
import { StepItem } from '@/app/view-items';
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { useCommand, type RegisteredCommandId } from '@/app/use-command';
import type { DocumentStore } from '@/state/document';
import type { EditingStore } from '@/state/editing';
import type { SelectionStore } from '@/state/selection';

import { resolveCursor } from './cursor';
import type { EntryStore } from './entry-store';
import { rhythmLabel } from './rhythm';
import { wordLabel } from './word-session';

export interface EditStatusLineProps {
  entry: EntryStore;
  editing: EditingStore;
  selection: SelectionStore;
  document: DocumentStore;
}

function VoiceItem({
  command,
  voice,
  label,
}: {
  command: RegisteredCommandId;
  voice: string;
  label: string;
}) {
  const bound = useCommand(command);
  return (
    <DropdownMenuRadioItem value={voice} onSelect={bound.run}>
      {label}
      {bound.keys && <DropdownMenuShortcut className="mr-4">{bound.keys}</DropdownMenuShortcut>}
    </DropdownMenuRadioItem>
  );
}

const separator = (
  <span aria-hidden="true" className="px-0.5">
    {' · '}
  </span>
);

/**
 * The entry state, in the status bar's right half while editing: insert or overwrite, the voice,
 * the current duration and where the cursor is, each a segment that runs its command or opens a
 * menu, then the word being typed, the digit waiting for a second one and the last refusal. Only
 * the refusal is a live region, so it is announced and the position that changes with every key is
 * not. The text reads as before: `Overwrite · Voice 1 · Quarter · Bar 3 · Beat 2 · String 4`.
 */
export function EditStatusLine({ entry, editing, selection, document }: EditStatusLineProps) {
  const isEditing = useStore(editing, (state) => state.editing);
  const { rhythm, mode, pending, message, tone, word } = useStore(entry);
  const cursor = useStore(selection, (state) => state.cursor);
  const score = useStore(document, (state) => state.score);
  if (!isEditing) return null;
  const at = cursor && score && resolveCursor(score, cursor);
  const voice = cursor?.voice ?? 0;
  const position =
    at &&
    [
      `Bar ${String(at.bar + 1)}`,
      cursor.beat === undefined ? 'End of bar' : `Beat ${String(at.stop + 1)}`,
      ...(cursor.string > 0 ? [`String ${String(cursor.string)}`] : []),
    ].join(' · ');
  const segments = [
    <StatusSegment
      key="mode"
      command="editor.toggleInsertMode"
      label="Switch between insert and overwrite"
    >
      {mode === 'insert' ? 'Insert' : 'Overwrite'}
    </StatusSegment>,
    <StatusMenu
      key="voice"
      label="Voice"
      align="start"
      menu={
        <>
          <DropdownMenuLabel>Voice</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={String(voice)}>
            <VoiceItem command="editor.editVoice1" voice="0" label="Voice 1" />
            <VoiceItem command="editor.editVoice2" voice="1" label="Voice 2" />
          </DropdownMenuRadioGroup>
        </>
      }
    >
      {`Voice ${String(voice + 1)}`}
    </StatusMenu>,
    <StatusMenu
      key="duration"
      label="Duration"
      align="start"
      menu={
        <>
          <DropdownMenuLabel>Duration</DropdownMenuLabel>
          <StepItem command="editor.durationLonger" label="Longer" />
          <StepItem command="editor.durationShorter" label="Shorter" />
          <StepItem command="editor.toggleDot" label="Dotted" />
          <StepItem command="editor.toggleDoubleDot" label="Double dotted" />
          <StepItem command="editor.toggleTriplet" label="Triplet" />
        </>
      }
    >
      {rhythmLabel(rhythm)}
    </StatusMenu>,
    ...(position
      ? [
          <StatusSegment
            key="position"
            command="app.commandPalette"
            label="Open the command palette"
          >
            {position}
          </StatusSegment>,
        ]
      : []),
  ];
  return (
    <div data-testid="edit-status" className="flex min-w-0 items-center gap-1">
      <span className="flex shrink-0 items-center">
        {segments.map((segment, index) => (
          <Fragment key={segment.key}>
            {index > 0 && separator}
            {segment}
          </Fragment>
        ))}
      </span>
      {word && <span className="text-foreground font-medium">{wordLabel(word)}</span>}
      {pending && <span className="text-foreground font-medium">Fret {String(pending.fret)}…</span>}
      {/* Only the message is announced; the position changes with every key. The visible text
          truncates in a narrow window and `title` carries it whole. */}
      <span
        role="status"
        aria-live="polite"
        title={message || undefined}
        className={
          tone === 'notice'
            ? 'text-foreground min-w-0 truncate font-medium'
            : 'text-destructive min-w-0 truncate font-medium'
        }
      >
        {message}
      </span>
    </div>
  );
}
