import { useStore } from 'zustand';

import { keepFocus, tooltipText } from '@/app/command-control';
import { useAppServices } from '@/app/services-context';
import { useStaticContextMenu } from '@/app/context-menu/use-context-menu';
import { useCommand } from '@/app/use-command';
import { documentNameOf } from '@/app/window-title';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * "Library › Song title". The crumb only runs `library.show` and never reads the sheet, so it
 * stays as it is when the library becomes a sheet.
 */
export function LibraryCrumb() {
  const { document } = useAppServices();
  const open = useStore(document, (state) => state.score !== undefined);
  const name = useStore(document, (state) => documentNameOf(state));
  const show = useCommand('library.show');
  const menu = useStaticContextMenu({
    surface: 'header',
    target: { kind: 'header', element: 'crumb' },
    label: 'Library',
  });

  return (
    <nav aria-label="Breadcrumb" className="min-w-0" {...menu}>
      <ol className="flex min-w-0 items-center gap-1 text-xs">
        <li className="shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground whitespace-nowrap"
                aria-keyshortcuts={show.ariaKeys}
                onMouseDown={keepFocus}
                onClick={show.run}
              >
                Library
              </Button>
            </TooltipTrigger>
            <TooltipContent>{tooltipText('Show library', show.keys)}</TooltipContent>
          </Tooltip>
        </li>
        {open && (
          <>
            <li aria-hidden="true" className="text-muted-foreground shrink-0">
              ›
            </li>
            <li className="min-w-0">
              <span
                aria-current="page"
                className="block truncate font-medium whitespace-nowrap"
                title={name}
              >
                {name}
              </span>
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}
