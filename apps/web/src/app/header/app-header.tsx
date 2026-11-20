import { useStaticContextMenu } from '../context-menu/use-context-menu';
import { LibraryCrumb } from './library-crumb';
import { ModeSwitch } from './mode-switch';
import { PaletteSearch } from './palette-search';
import { ViewMenu } from './view-menu';

/**
 * The slim band above the score. It is a `<header>` at the top level, so it is the banner
 * landmark, and not a toolbar, which would take the arrow keys the radio group needs. Both side
 * zones grow equally so the mode switch stays centred.
 */
export function AppHeader() {
  const menu = useStaticContextMenu({
    surface: 'header',
    target: { kind: 'header', element: 'band' },
    label: 'Header',
  });
  return (
    <header {...menu} className="bg-background flex h-7 shrink-0 items-center gap-2 border-b px-2">
      <div className="flex min-w-0 flex-1 basis-0 items-center">
        <LibraryCrumb />
      </div>
      <div className="shrink-0">
        <ModeSwitch />
      </div>
      <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1">
        <ViewMenu />
        <PaletteSearch />
      </div>
    </header>
  );
}
