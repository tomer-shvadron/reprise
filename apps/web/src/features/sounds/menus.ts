import type { MenuContext, MenuContribution } from '@/app/context-menu/types';

import { curatedPack, packPageUrl, updateAvailable } from './curated-packs';

const packOf = ({ services, target }: MenuContext) =>
  target.kind === 'soundPack' && target.state === 'installed'
    ? services.sounds.getState().packs.find((pack) => pack.id === target.id)
    : undefined;

const stateIs =
  (state: 'installed' | 'available' | 'damaged') =>
  ({ target }: MenuContext) =>
    target.kind === 'soundPack' && target.state === state;

const canDownload = ({ services }: MenuContext) => services.platform.download !== undefined;

const pageUrl = (at: MenuContext) => {
  const { target } = at;
  if (target.kind !== 'soundPack' || target.state === 'damaged') return undefined;
  return packPageUrl(target.id, packOf(at));
};

/** The Sounds sheet's pack rows: installed, available (listed, not installed) and damaged folders. */
export const soundsMenus: readonly MenuContribution[] = [
  {
    surface: 'sounds.pack',
    items: [
      {
        command: 'sounds.renamePack',
        group: 'edit',
        // Only a custom pack is renamed; a curated one keeps the list's name.
        when: (at) => packOf(at)?.curated === false,
      },
      {
        command: 'sounds.updatePack',
        group: 'edit',
        when: (at) => {
          const pack = packOf(at);
          return (
            pack !== undefined &&
            pack.curated &&
            updateAvailable(pack) &&
            canDownload(at) &&
            curatedPack(pack.id)?.directDownload === true
          );
        },
      },
      {
        command: 'sounds.downloadPack',
        group: 'edit',
        when: (at) =>
          stateIs('available')(at) &&
          canDownload(at) &&
          at.target.kind === 'soundPack' &&
          curatedPack(at.target.id)?.directDownload === true,
      },
      { command: 'sounds.openPackPage', group: 'view', when: (at) => pageUrl(at) !== undefined },
      {
        command: 'sounds.removePack',
        group: 'danger',
        when: (at) => stateIs('installed')(at) || stateIs('damaged')(at),
        label: ({ target }) =>
          target.kind === 'soundPack' && target.state === 'damaged' ? 'Remove folder' : 'Remove…',
      },
    ],
  },
];
