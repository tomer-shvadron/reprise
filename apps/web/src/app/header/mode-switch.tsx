import { useStore } from 'zustand';

import { keepFocus } from '@/app/command-control';
import { CommandTooltip } from '@/app/command-tooltip';
import { useAppServices } from '@/app/services-context';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useCommand } from '@/app/use-command';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type Mode = 'play' | 'practice' | 'edit';

const MODES: readonly { mode: Mode; label: string }[] = [
  { mode: 'play', label: 'Play' },
  { mode: 'practice', label: 'Practice' },
  { mode: 'edit', label: 'Edit' },
];

const isMode = (value: string): value is Mode =>
  value === 'play' || value === 'practice' || value === 'edit';

/**
 * Play, Practice and Edit as one radio group; the value is read from the stores, never held here.
 * Practice hides this header, so choosing Play or Edit from it is only for completeness.
 */
export function ModeSwitch() {
  const { editing, document, ui } = useAppServices();
  const practising = useStore(ui, (state) => state.practiceMode.on);
  const editingNow = useStore(editing, (state) => state.editing);
  const mode: Mode = practising ? 'practice' : editingNow ? 'edit' : 'play';
  const hasScore = useStore(document, (state) => state.score !== undefined);
  const toggle = useCommand('editor.toggleMode');
  const practice = useCommand('view.practiceMode');
  const menu = useStaticContextMenu({
    surface: 'header',
    target: { kind: 'header', element: 'mode' },
    label: 'Mode',
  });

  return (
    <ToggleGroup
      type="single"
      size="sm"
      aria-label="Mode"
      {...menu}
      value={mode}
      className="bg-muted h-6 gap-0.5 p-0.5"
      onValueChange={(next) => {
        // Pressing the checked segment reports ''; only another one switches mode.
        if (!isMode(next) || next === mode) return;
        if (next === 'practice') practice.run();
        else if (practising) {
          ui.getState().leavePracticeMode();
          editing.getState().setEditing(next === 'edit');
        } else toggle.run();
      }}
    >
      {MODES.map(({ mode: value, label }) => {
        const commandId = value === 'practice' ? 'view.practiceMode' : 'editor.toggleMode';
        return (
          <CommandTooltip key={value} command={commandId} label={`${label} mode`}>
            <ToggleGroupItem
              value={value}
              aria-label={label}
              disabled={value !== 'play' && !hasScore}
              onMouseDown={keepFocus}
              className="text-foreground hover:bg-background/60 hover:text-foreground aria-checked:bg-primary aria-checked:text-primary-foreground aria-checked:hover:bg-primary aria-checked:hover:text-primary-foreground h-5 min-w-0 rounded-md px-2.5 text-xs aria-checked:shadow-xs dark:aria-checked:shadow-none"
            >
              {label}
            </ToggleGroupItem>
          </CommandTooltip>
        );
      })}
    </ToggleGroup>
  );
}
