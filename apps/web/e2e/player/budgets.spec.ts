import { appendFileSync, readFileSync } from 'node:fs';

// eslint-disable-next-line import-x/no-relative-packages -- the root package exports nothing; the budgets table has one parser
import { loadBudgets, type ResolvedBudget } from '../../../../scripts/bench/budgets.ts';
import { App, expect, installHooks, test } from './test/app';
import { REPO, generated } from './test/scores';

const LONG_SCORE = 'long-score.reprise';

// Recording would perturb both measurements.
test.use({ trace: 'off', video: 'off' });

function budget(metric: string): ResolvedBudget {
  const { budgets, error } = loadBudgets(`${REPO}docs/plans/roadmap.md`, process.env);
  if (error !== '') throw new Error(error);
  const row = budgets.find((candidate) => candidate.metric === metric);
  if (!row) throw new Error(`docs/plans/roadmap.md has no budget row "${metric}"`);
  return row;
}

const SUMMARY_HEADER = '| Metric | Budget | Threshold | Measured | Status |';

function report(row: ResolvedBudget, measured: number): void {
  const pass = measured <= row.threshold;
  const value = (n: number) => `${String(Math.round(n * 10) / 10)} ${row.unit}`;
  console.log(
    `budget: ${row.metric}: ${value(measured)} (threshold ${value(row.threshold)}, budget ${value(row.value)} ×${String(row.factor)})`,
  );
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary === undefined || summary === '') return;
  const header = readFileSync(summary, 'utf8').includes(SUMMARY_HEADER)
    ? ''
    : `\n${SUMMARY_HEADER}\n| --- | --- | --- | --- | --- |\n`;
  appendFileSync(
    summary,
    `${header}| ${row.metric} | ${value(row.value)} | ${value(row.threshold)} | ${value(measured)} | ${pass ? 'pass' : 'fail'} |\n`,
  );
}

test('Time from file drop to first paint', async ({ browser, baseURL }) => {
  const row = budget('Time from file drop to first paint');
  const times: number[] = [];
  for (let run = 0; run < 3; run += 1) {
    const context = await browser.newContext({
      ...(baseURL !== undefined && { baseURL }),
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await installHooks(page);
    await page.goto('/');
    const app = new App(page);
    await app.serve(generated(LONG_SCORE), LONG_SCORE);
    await app.prepareDrop(LONG_SCORE);
    times.push(
      await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const painted = () => {
              void document.fonts.ready.then(() => {
                requestAnimationFrame(() => {
                  resolve(performance.now() - start);
                });
              });
            };
            const observer = new MutationObserver(() => {
              if (document.querySelector('[data-system-id]')) {
                observer.disconnect();
                painted();
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            const file: unknown = Reflect.get(window, '__e2eDrop');
            if (!(file instanceof File)) throw new Error('No file prepared to drop');
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            const start = performance.now();
            window.dispatchEvent(
              new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }),
            );
          }),
      ),
    );
    await context.close();
  }
  const median = [...times].sort((a, b) => a - b)[1] ?? Number.NaN;
  report(row, median);
  expect(median, `runs: ${times.map((time) => time.toFixed(0)).join(', ')} ms`).toBeLessThanOrEqual(
    row.threshold,
  );
});

test('Renderer heap after opening the long score', async ({ app, page }) => {
  const row = budget('Renderer heap after opening the long score');
  await app.drop(generated(LONG_SCORE), LONG_SCORE);
  await app.waitReady(LONG_SCORE);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  const megabytes = usedSize / (1024 * 1024);
  report(row, megabytes);
  expect(megabytes).toBeLessThanOrEqual(row.threshold);
});
