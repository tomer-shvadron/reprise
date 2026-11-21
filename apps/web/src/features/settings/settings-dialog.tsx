import { useRef, useState } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { SettingsSection } from './section';

/**
 * Preferences, one section at a time. Changes apply at once and persist through the settings
 * store; "Restore defaults" resets the keys of the section on screen. A later feature adds a
 * section to `app/settings-sections.ts` and never edits this file.
 */
export function SettingsDialog({ sections }: { sections: readonly SettingsSection[] }) {
  const { ui, settings } = useAppServices();
  const open = useStore(ui, (state) => state.settings.open);
  const requested = useStore(ui, (state) => state.settings.section);
  // The last section shown stays for the session; a request names another one. Adjusted while
  // rendering, not in an effect, so the dialog never paints the old section first.
  const [shown, setShown] = useState<string | undefined>(undefined);
  const [seen, setSeen] = useState({ open, requested });
  if (seen.open !== open || seen.requested !== requested) {
    setSeen({ open, requested });
    if (open && requested !== undefined) setShown(requested);
  }

  // Radix sends focus to the dialog's trigger on close, and this one has none, so the element that
  // had focus is kept on open and given it back on close.
  const returnTo = useRef<Element | null>(null);

  const current = sections.find((section) => section.id === shown) ?? sections[0];
  if (!current) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) ui.getState().closeSettings();
      }}
    >
      <DialogContent
        showCloseButton
        className="h-[min(80vh,40rem)] gap-0 overflow-hidden p-0 sm:max-w-3xl"
        aria-describedby="settings-description"
        onEscapeKeyDown={(event) => {
          // Radix listens for Escape in the capture phase, before a React handler can stop it; a
          // local Escape (the key recorder, its swap prompt) cancels only itself.
          if (event.target instanceof Element && event.target.closest('[data-escape-local]')) {
            event.preventDefault();
          }
        }}
        onOpenAutoFocus={() => {
          // Fires before Radix moves focus in, so this is still the opener.
          returnTo.current = globalThis.document.activeElement;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnTo.current;
          returnTo.current = null;
          if (
            target instanceof HTMLElement &&
            target.isConnected &&
            target !== globalThis.document.body
          ) {
            target.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">Settings</DialogTitle>
        <DialogDescription id="settings-description" className="sr-only">
          Preferences apply as you change them.
        </DialogDescription>
        <Tabs
          orientation="vertical"
          value={current.id}
          onValueChange={setShown}
          className="h-full gap-0"
        >
          <TabsList
            aria-label="Settings sections"
            className="bg-muted/40 w-48 shrink-0 border-r p-2 pt-12"
          >
            {sections.map((section) => (
              <TabsTrigger key={section.id} value={section.id}>
                {section.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {sections.map((section) => (
            <TabsContent key={section.id} value={section.id} className="flex flex-col">
              <h2 className="font-heading px-6 pt-4 text-base font-medium">{section.title}</h2>
              <ScrollArea className="min-h-0 flex-1">
                <div className="px-6 pb-4">
                  <section.Component />
                </div>
              </ScrollArea>
              <div className="flex justify-end border-t px-6 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    settings.reset(section.settings);
                  }}
                >
                  Restore defaults
                </Button>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
