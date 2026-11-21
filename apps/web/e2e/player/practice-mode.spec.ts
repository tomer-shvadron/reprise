import type { Page } from '@playwright/test';

import { expect, test, type Box } from './test/app';
import { generated, SECTIONS } from './test/scores';
import { storedSetting } from './test/stored-setting';

test.beforeEach(async ({ app }) => {
  await app.openWithPicker(generated(SECTIONS.file));
});

const radio = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const strip = (page: Page) => page.getByRole('navigation', { name: 'Sections' });
const capsule = (page: Page) => page.getByRole('region', { name: 'Practice controls' });

/** What practice mode hides, as the window had it. */
const CHROME = [
  (page: Page) => page.getByRole('banner'),
  (page: Page) => page.getByRole('complementary', { name: 'Tracks' }),
  (page: Page) => page.getByRole('complementary', { name: 'Panel' }),
  (page: Page) => page.getByRole('group', { name: 'Panel rail' }),
  (page: Page) => page.getByRole('region', { name: 'Bottom panel' }),
  (page: Page) => page.getByRole('contentinfo', { name: 'Transport' }),
] as const;

async function boxes(page: Page): Promise<(Box | null)[]> {
  return Promise.all(CHROME.map((find) => find(page).boundingBox()));
}

test('entering hides the chrome and Escape brings back the exact window', async ({ page }) => {
  await page.keyboard.press('F8');
  const handle = page.getByRole('separator', { name: 'Resize panel' });
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('region', { name: 'Bottom panel' }).getByRole('button').first().click();
  await page.getByRole('tab', { name: 'Fretboard' }).click();
  await expect.poll(() => storedSetting(page, 'layout.rightPanelWidth')).toBeGreaterThan(320);
  const panelWidth = await handle.getAttribute('aria-valuenow');
  const before = await boxes(page);
  const stored = [
    await storedSetting(page, 'layout.rightPanelWidth'),
    await storedSetting(page, 'layout.rightPanelOpen'),
    await storedSetting(page, 'layout.bottomDockOpen'),
    await storedSetting(page, 'layout.bottomDockHeight'),
  ];

  await radio(page, 'Practice').click();
  for (const find of CHROME) await expect(find(page)).toHaveCount(0);
  await expect(strip(page)).toBeVisible();
  await expect(capsule(page)).toBeVisible();
  const main = await page.getByRole('main', { name: 'Score' }).boundingBox();
  expect(main?.width).toBeCloseTo(1440, 0);

  await page.keyboard.press('Escape');
  await expect(radio(page, 'Play')).toBeChecked();
  const after = await boxes(page);
  after.forEach((box, index) => {
    const was = before[index];
    expect(box?.x).toBeCloseTo(was?.x ?? NaN, 0);
    expect(box?.y).toBeCloseTo(was?.y ?? NaN, 0);
    expect(box?.width).toBeCloseTo(was?.width ?? NaN, 0);
    expect(box?.height).toBeCloseTo(was?.height ?? NaN, 0);
  });
  await expect(handle).toHaveAttribute('aria-valuenow', panelWidth ?? '');
  expect([
    await storedSetting(page, 'layout.rightPanelWidth'),
    await storedSetting(page, 'layout.rightPanelOpen'),
    await storedSetting(page, 'layout.bottomDockOpen'),
    await storedSetting(page, 'layout.bottomDockHeight'),
  ]).toEqual(stored);
});

test('the song plays from the mode, by Space and by the capsule', async ({ app, page }) => {
  await radio(page, 'Practice').click();
  await expect(app.playButton).toHaveAccessibleName('Play');
  await page.keyboard.press('Space');
  await expect(app.playButton).toHaveAccessibleName('Pause');
  await capsule(page).getByRole('button', { name: 'Pause' }).click();
  await expect(app.playButton).toHaveAccessibleName('Play');
});

test('a section loops from the strip, and the loop survives leaving', async ({ page }) => {
  await radio(page, 'Practice').click();
  const chorus = strip(page).getByRole('button', { name: /^Chorus 2/ });
  await chorus.click();
  await expect(chorus).toHaveAttribute('aria-pressed', 'true');
  await expect(
    capsule(page).getByRole('button', { name: `Loop bars ${SECTIONS.chorus2Bars}` }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(
    page
      .getByRole('contentinfo')
      .getByRole('button', { name: `Loop bars ${SECTIONS.chorus2Bars}` }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('Escape leaves with a tooltip open, in one press', async ({ page }) => {
  await radio(page, 'Practice').click();
  await expect(capsule(page)).toBeVisible();
  await strip(page).getByRole('button').first().hover();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(capsule(page)).toHaveCount(0);
  await expect(radio(page, 'Play')).toBeChecked();
});

test('F11 enters, the first Escape closes a popover, the second leaves, and Edit comes back', async ({
  page,
}) => {
  await page.keyboard.press('ControlOrMeta+e');
  await expect(radio(page, 'Edit')).toBeChecked();
  await page.keyboard.press('F11');
  await expect(capsule(page)).toBeVisible();
  await capsule(page).getByRole('button', { name: 'Metronome volume' }).click();
  const popover = page.getByRole('slider', { name: /volume/i });
  await expect(popover).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popover).toHaveCount(0);
  await expect(capsule(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(capsule(page)).toHaveCount(0);
  await expect(radio(page, 'Edit')).toBeChecked();
});

test('the capsule has a shadow in light and an outline in dark', async ({ page }) => {
  await radio(page, 'Practice').click();
  for (const [scheme, shadow] of [
    ['light', true],
    ['dark', false],
  ] as const) {
    await page.evaluate((theme) => {
      document.documentElement.dataset['theme'] = theme;
    }, scheme);
    const style = await capsule(page).evaluate((element) => {
      const computed = getComputedStyle(element);
      // Tailwind composes `box-shadow` from layers, so "no shadow" is transparent layers, not `none`.
      const layers = computed.boxShadow.split(/,(?![^(]*\))/u).map((layer) => layer.trim());
      const visible = layers.some(
        (layer) => layer !== 'none' && !layer.includes('rgba(0, 0, 0, 0)'),
      );
      return { visible, border: computed.borderTopColor };
    });
    expect(style.visible).toBe(shadow);
    // The capsule has a 1px transparent border in both themes, so the colour tells them apart.
    if (shadow) expect(style.border).toBe('rgba(0, 0, 0, 0)');
    else expect(style.border).not.toBe('rgba(0, 0, 0, 0)');
  }
});

test('a looped bar ends above the capsule, and the page is zoomed 1.5 times', async ({
  app,
  page,
}) => {
  const pageWidth = () =>
    page
      .locator('.score-page')
      .first()
      .evaluate((el) => el.clientWidth);
  const normal = await pageWidth();
  await radio(page, 'Practice').click();
  await expect(capsule(page)).toBeVisible();
  await expect.poll(pageWidth).toBeCloseTo(normal * 1.5, -1);

  await page.keyboard.press('ControlOrMeta+End');
  await app.settle();
  const bar = await page.locator('[data-playhead] .score-bar-highlight').boundingBox();
  const pill = await capsule(page).boundingBox();
  expect(bar).not.toBeNull();
  expect(pill).not.toBeNull();
  expect((bar?.y ?? Infinity) + (bar?.height ?? 0)).toBeLessThanOrEqual(pill?.y ?? 0);
});

test('Escape returns focus to the control that had it, and the mixer does not take it', async ({
  page,
}) => {
  await page.keyboard.press('F8');
  const slider = page.getByRole('slider', { name: /^Volume of / }).first();
  await slider.focus();
  await page.keyboard.press('F11');
  await expect(capsule(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(capsule(page)).toHaveCount(0);
  await expect(slider).toBeFocused();

  const practice = radio(page, 'Practice');
  await practice.focus();
  await page.keyboard.press('Space');
  await expect(capsule(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(capsule(page)).toHaveCount(0);
  await expect(practice).toBeFocused();
});

test('a click entry leaves focus on the body, with no frame around the window', async ({
  page,
}) => {
  await radio(page, 'Practice').click();
  await expect(capsule(page)).toBeVisible();
  await expect(page.locator('body')).toBeFocused();
});

test('at 800 by 600 the capsule and the strip fit the window', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await radio(page, 'Practice').click();
  const box = await capsule(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(800);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
