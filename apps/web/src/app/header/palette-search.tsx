import { SearchIcon } from 'lucide-react';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useCommand } from '@/app/use-command';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A button styled as a search field. A real input that opens a dialog on focus is an
 * accessibility trap, and would add a second searchbox next to the library's.
 */
export function PaletteSearch() {
  const palette = useCommand('app.commandPalette');
  const menu = useStaticContextMenu({
    surface: 'header',
    target: { kind: 'header', element: 'search' },
    label: 'Search',
  });
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="xs"
          aria-label="Search commands"
          {...menu}
          aria-haspopup="dialog"
          aria-keyshortcuts={palette.ariaKeys}
          onMouseDown={keepFocus}
          onClick={palette.run}
          className="dark:bg-input/30 size-6 shrink-0 justify-start px-0 lg:w-48 lg:px-2"
        >
          <SearchIcon className="mx-auto lg:mx-0" aria-hidden="true" />
          <span className="text-muted-foreground hidden flex-1 text-left font-normal whitespace-nowrap lg:inline">
            Search commands…
          </span>
          {palette.keys && (
            <kbd className="text-muted-foreground hidden font-sans text-[0.7rem] lg:inline">
              {palette.keys}
            </kbd>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tooltipText('Search commands', palette.keys)}</TooltipContent>
    </Tooltip>
  );
}
