import { expect, test, type App } from './test/app';
import { generated } from './test/scores';
import type { Locator } from '@playwright/test';

// #471: a focused control shows the solid `--ring`, not the 50% halo (about 1.85:1, under WCAG
// 1.4.11's 3:1), and nothing clips it. The check reads the computed box-shadow, so it fails on a
// halo-only or translucent ring, and measures the room around the element against every ancestor
// that clips, so it fails on a ring cut to a sliver.

interface Ring {
  shadows: { alpha: number; spread: number; inset: boolean }[];
  clipped: boolean;
}

async function ring(target: Locator): Promise<Ring> {
  return target.evaluate((el) => {
    const parse = (value: string) =>
      value
        .split(/,(?![^(]*\))/)
        .map((part) => part.trim())
        .filter((part) => part !== 'none' && part !== '')
        .map((part) => {
          const color = /(?:oklab|oklch|rgba?|color)\([^)]*\)/.exec(part)?.[0] ?? '';
          const alpha = /\/\s*([\d.]+)(%?)\s*\)/.exec(color);
          const nums = part.replace(color, '').match(/-?[\d.]+px/g) ?? [];
          return {
            alpha: alpha ? Number(alpha[1]) / (alpha[2] ? 100 : 1) : 1,
            spread: Number.parseFloat(nums[3] ?? '0'),
            inset: part.includes('inset'),
          };
        });
    const shadows = parse(getComputedStyle(el).boxShadow).filter((s) => s.spread > 0);
    const outer = Math.max(0, ...shadows.filter((s) => !s.inset).map((s) => s.spread));
    const box = el.getBoundingClientRect();
    let clipped = false;
    for (let p = el.parentElement; p && outer > 0; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
      const pb = p.getBoundingClientRect();
      const room = Math.min(
        box.left - pb.left,
        box.top - pb.top,
        pb.right - box.right,
        pb.bottom - box.bottom,
      );
      if (room < outer) clipped = true;
    }
    return { shadows, clipped };
  });
}

async function expectSolidRing(target: Locator): Promise<void> {
  await target.focus();
  expect(await target.evaluate((el) => el.matches(':focus-visible'))).toBe(true);
  // Controls transition their box-shadow, so wait for the ring to settle before judging it.
  await expect
    .poll(async () => (await ring(target)).shadows.some((s) => s.alpha >= 0.99), {
      message: 'a solid (alpha 1) ring shadow',
    })
    .toBe(true);
  const { clipped } = await ring(target);
  expect(clipped).toBe(false);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test('keyboard focus draws a solid, unclipped ring', async ({
      app,
      page,
    }: {
      app: App;
      page: App['page'];
    }) => {
      await app.openWithPicker(generated('song.gp'));
      await page.keyboard.press('F8');
      await expect(app.strip(1)).toBeVisible();

      await page.keyboard.press('Shift');
      await expectSolidRing(
        page.locator('[role=tablist][aria-label="Panel views"] [role=tab]').first(),
      );
      await expectSolidRing(page.locator('[aria-label="Bottom panel views"] [role=tab]').first());
      await expectSolidRing(app.strip(1).getByRole('button', { name: 'Mute Track 1' }));
      await expectSolidRing(app.strip(1).getByRole('slider', { name: 'Volume of Track 1' }));

      await app.palette('Show library');
      const list = page.getByRole('listbox', { name: 'Songs' });
      await expect(list).toBeVisible();
      await expectSolidRing(list);
    });
  });
}
