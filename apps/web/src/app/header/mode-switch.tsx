import { useStore } from 'zustand';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useAppServices } from '@/app/services-context';
import { useCommand } from '@/app/use-command';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

type Mode = 'play' | 'edit';

// Practice joins between Play and Edit in #341, with its own command; until then a segment that
// cannot be chosen would only be noise.
const MODES: readonly { mode: Mode; label: string }[] = [
  { mode: 'play', label: 'Play' },
  { mode: 'edit', label: 'Edit' },
];

/** Play and Edit as one radio group; the value is read from the editing store, never held here. */
export function ModeSwitch() {
  const { editing, document } = useAppServices();
  const mode: Mode = useStore(editing, (state) => (state.editing ? 'edit' : 'play'));
  const hasScore = useStore(document, (state) => state.score !== undefined);
  const toggle = useCommand('editor.toggleMode');

  return (
    <ToggleGroup
      type="single"
      size="sm"
      aria-label="Mode"
      value={mode}
      className="bg-muted h-6 gap-0.5 p-0.5"
      onValueChange={(next) => {
        // Pressing the checked segment reports ''; only the other one switches mode.
        if ((next === 'play' || next === 'edit') && next !== mode) toggle.run();
      }}
    >
      {MODES.map(({ mode: value, label }) => (
        <Tooltip key={value}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={value}
              aria-label={label}
              aria-keyshortcuts={toggle.ariaKeys}
              disabled={value === 'edit' && !hasScore}
              onMouseDown={keepFocus}
              className="text-foreground hover:bg-background/60 hover:text-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-5 min-w-0 rounded-md px-2.5 text-xs data-[state=on]:shadow-xs dark:data-[state=on]:shadow-none"
            >
              {label}
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent>{tooltipText(`${label} mode`, toggle.keys)}</TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
