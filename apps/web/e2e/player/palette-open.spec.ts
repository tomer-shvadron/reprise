import { expect, test } from './test/app';
import { generated } from './test/scores';

const OPENS = 20;

/**
 * Measures, never asserts: the e2e rule is to wait on state, not time. The figure goes in the
 * report's annotations so every CI run shows it. From the Cmd+K keydown, timed in a capture
 * listener, to the first palette item in the DOM.
 */
test('records how long the command palette takes to open on the long score', async ({
  app,
  page,
}) => {
  await app.openWithPicker(generated('long-score.reprise'));
  await app.gesture();
  await page.evaluate(() => {
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
          Reflect.set(window, '__paletteStart', performance.now());
        }
      },
      true,
    );
  });
  const samples: number[] = [];
  for (let i = 0; i < OPENS; i += 1) {
    await expect(page.locator('[cmdk-input]')).toHaveCount(0);
    // Armed before the key: the observer resolves when the first item reaches the DOM.
    await page.evaluate(() => {
      Reflect.set(
        window,
        '__paletteShown',
        new Promise<number>((resolve) => {
          const observer = new MutationObserver(() => {
            if (document.querySelector('[cmdk-item]')) {
              observer.disconnect();
              const start: unknown = Reflect.get(window, '__paletteStart');
              resolve(performance.now() - Number(start));
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        }),
      );
    });
    await page.keyboard.press('ControlOrMeta+k');
    samples.push(
      await page.evaluate(() => Reflect.get(window, '__paletteShown') as Promise<number>),
    );
    await page.keyboard.press('Escape');
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
  test.info().annotations.push({
    type: 'palette-open-ms',
    description: `median ${median.toFixed(1)}, p95 ${p95.toFixed(1)} over ${String(samples.length)} opens`,
  });
  expect(samples).toHaveLength(OPENS);
});
