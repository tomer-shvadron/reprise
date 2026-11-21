import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { curatedPack, packPageUrl } from './curated-packs';

export type SoundsCommandId =
  | 'sounds.show'
  | 'sounds.renamePack'
  | 'sounds.updatePack'
  | 'sounds.openPackPage'
  | 'sounds.removePack'
  | 'sounds.downloadPack';

type SoundsCommand = Command & { id: SoundsCommandId };

export function soundsCommands(
  services: Pick<AppServices, 'ui' | 'sounds' | 'menuTarget' | 'platform'>,
): SoundsCommand[] {
  const { ui, sounds, menuTarget, platform } = services;
  const target = () => {
    const current = menuTarget.getState().target;
    return current?.kind === 'soundPack' ? current : undefined;
  };
  const idle = () => sounds.getState().job === undefined;
  const asked = (state: 'installed' | 'available' | 'damaged') => target()?.state === state;
  const installed = () => {
    const current = target();
    return current?.state === 'installed'
      ? sounds.getState().packs.find((pack) => pack.id === current.id)
      : undefined;
  };
  /** The pack's page: the list's address first, as the row's own link does. */
  const pageOf = () => {
    const current = target();
    if (!current || current.state === 'damaged') return undefined;
    const pack = installed();
    return packPageUrl(current.id, pack);
  };
  return [
    {
      id: 'sounds.show',
      title: 'Show sound manager',
      run: () => {
        ui.getState().showSheet('sounds');
      },
    },
    {
      id: 'sounds.renamePack',
      title: 'Rename sound pack',
      inPalette: false,
      enabled: () => asked('installed'),
      run: () => {
        const current = target();
        if (current) sounds.api.setState({ renamingId: current.id });
      },
    },
    {
      id: 'sounds.updatePack',
      title: 'Update sound pack',
      inPalette: false,
      enabled: () => asked('installed') && idle(),
      run: () => {
        const current = target();
        const listed = current && curatedPack(current.id);
        if (listed) void sounds.installCurated(listed);
      },
    },
    {
      id: 'sounds.openPackPage',
      title: 'Open download page',
      inPalette: false,
      enabled: () => pageOf() !== undefined,
      run: () => {
        const url = pageOf();
        if (url !== undefined) globalThis.open(url, '_blank', 'noopener,noreferrer');
      },
    },
    {
      id: 'sounds.removePack',
      title: 'Remove sound pack',
      inPalette: false,
      enabled: () => (asked('installed') || asked('damaged')) && idle(),
      run: () => {
        const current = target();
        if (!current) return;
        if (current.state === 'installed') {
          sounds.api.setState({ removingId: current.id });
          return;
        }
        // The row is gone afterwards and took focus with it: the screen moves it to its heading.
        void sounds.removeDamaged(current.id).then((removed) => {
          if (removed) sounds.api.setState({ focusAfter: 'installed-heading' });
        });
      },
    },
    {
      id: 'sounds.downloadPack',
      title: 'Download sound pack',
      inPalette: false,
      enabled: () => asked('available') && idle() && platform.download !== undefined,
      run: () => {
        const current = target();
        const listed = current && curatedPack(current.id);
        if (listed) void sounds.installCurated(listed);
      },
    },
  ];
}
