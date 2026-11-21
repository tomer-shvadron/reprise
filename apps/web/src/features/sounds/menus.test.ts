import { describe, expect, it, vi } from 'vitest';

import { createAppMenus } from '@/app/app-menus';
import { createAppRegistry } from '@/app/app-registry';
import { commandsIn, resolveMenu } from '@/app/context-menu/resolve-menu';
import type { MenuTarget } from '@/state/menu-target';
import { createTestServices, fakePlatform } from '@/test/services';

import { CURATED_PACKS } from './curated-packs';
import type { InstalledPack, PackManifest } from './manifest';

const listed = CURATED_PACKS.find((pack) => pack.directDownload);
if (!listed) throw new Error('no direct-download pack in the list');

const installed = (manifest: PackManifest, extra: Partial<InstalledPack>): InstalledPack => ({
  ...manifest,
  curated: true,
  source: 'download',
  installedAt: '2026-01-01T00:00:00.000Z',
  files: [],
  ...extra,
});

function titles(options: { download: boolean; packs?: InstalledPack[]; target: MenuTarget }) {
  const services = createTestServices({
    platform: fakePlatform(options.download ? { download: vi.fn() } : {}),
  });
  services.sounds.api.setState({
    packs: options.packs ?? [],
    damaged: [{ folder: 'broken', reason: 'x' }],
  });
  const registry = createAppRegistry(services);
  const menus = createAppMenus(registry);
  services.menuTarget.getState().set(options.target);
  const entries = resolveMenu(
    menus,
    registry,
    'sounds.pack',
    { services, target: options.target, mode: 'play' },
    'mac',
  );
  return entries.flatMap((entry) => (entry.kind === 'item' ? [entry.label] : []));
}

describe('the sound pack row menus', () => {
  // A custom pack has no list entry, so no page.
  const bare = { ...listed };
  delete bare.sourceUrl;
  const custom = installed(bare, {
    id: 'custompack01',
    name: 'Mine',
    curated: false,
    source: 'folder',
    directDownload: false,
  });

  it('lists Rename and Remove for a custom pack, without a page', () => {
    expect(
      titles({
        download: true,
        packs: [custom],
        target: { kind: 'soundPack', id: custom.id, state: 'installed' },
      }),
    ).toEqual(['Rename sound pack', 'Remove…']);
  });

  it('lists Update, the page and Remove for an outdated curated pack on a platform that downloads', () => {
    const outdated = installed(listed, { version: '0' });
    const target: MenuTarget = { kind: 'soundPack', id: listed.id, state: 'installed' };
    expect(titles({ download: true, packs: [outdated], target })).toEqual([
      'Update sound pack',
      'Open download page',
      'Remove…',
    ]);
    // Without download, or when current, there is nothing to update.
    expect(titles({ download: false, packs: [outdated], target })).toEqual([
      'Open download page',
      'Remove…',
    ]);
    expect(titles({ download: true, packs: [installed(listed, {})], target })).toEqual([
      'Open download page',
      'Remove…',
    ]);
  });

  it('lists Download and the page for an available pack, the page alone without download', () => {
    const target: MenuTarget = { kind: 'soundPack', id: listed.id, state: 'available' };
    expect(titles({ download: true, target })).toEqual([
      'Download sound pack',
      'Open download page',
    ]);
    expect(titles({ download: false, target })).toEqual(['Open download page']);
  });

  it('lists only Remove folder for a damaged folder', () => {
    expect(
      titles({ download: true, target: { kind: 'soundPack', id: 'broken', state: 'damaged' } }),
    ).toEqual(['Remove folder']);
  });

  it('names registered commands only', () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const menus = createAppMenus(registry);
    const target: MenuTarget = { kind: 'soundPack', id: 'broken', state: 'damaged' };
    const entries = resolveMenu(
      menus,
      registry,
      'sounds.pack',
      { services, target, mode: 'play' },
      'mac',
    );
    expect(commandsIn(entries).every((command) => registry.get(command.id))).toBe(true);
  });
});
