import { expect, test } from './test/app';
import { FAKE_AUDIO_OUTPUT } from './test/fake-audio-output';
import { generated } from './test/scores';

// Chromium's fake microphone plays a generated A2, 12 cents sharp, on a loop. The headless shell
// the rest of the suite runs in answers getUserMedia with NotSupportedError, so this spec runs in
// full Chromium (its new headless mode), which the e2e job installs.
test.skip(
  process.platform !== 'linux',
  'macOS asks the system for the microphone even with the fake device, and the prompt hangs a headless run; use CI or Docker (see the README)',
);

test.use({
  channel: 'chromium',
  launchOptions: {
    args: [
      FAKE_AUDIO_OUTPUT,
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${generated('tuner-a2.wav')}`,
    ],
  },
});

test.describe('with the microphone allowed', () => {
  test.use({ permissions: ['microphone'] });

  test('reads A2 on string 5, and closes its audio context with the panel', async ({
    app,
    page,
  }) => {
    await app.openWithPicker(generated('song.gp'));
    await app.palette('Show tuner');
    const panel = page.getByRole('region', { name: 'Tuner' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Start' }).click();

    await expect(panel.getByRole('img', { name: 'A2', exact: true })).toBeVisible({
      timeout: 15_000,
    });
    const meter = panel.getByRole('meter', { name: 'Tuning' });
    await expect
      .poll(async () => {
        const cents = Number(await meter.getAttribute('aria-valuenow'));
        return cents >= 9 && cents <= 15;
      })
      .toBe(true);
    await expect(panel.getByRole('button', { name: 'String 5, A2' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    // The tuner's context is the last one made, after the player's.
    expect((await app.contextStates()).at(-1)).toBe('running');

    // F8 swaps the right panel to the mixer, which unmounts the tuner.
    await page.keyboard.press('F8');
    await expect(panel).toBeHidden();
    await expect.poll(async () => (await app.contextStates()).at(-1)).toBe('closed');
  });
});

test.describe('with the microphone refused', () => {
  test('says so and offers Try again', async ({ app, page }) => {
    await app.openWithPicker(generated('song.gp'));
    await app.palette('Show tuner');
    const panel = page.getByRole('region', { name: 'Tuner' });
    await panel.getByRole('button', { name: 'Start' }).click();
    await expect(panel.getByRole('alert')).toContainText('Microphone access is blocked');
    await expect(panel.getByRole('button', { name: 'Try again' })).toBeVisible();
    // The context made for the click is closed again rather than left running.
    await expect.poll(async () => (await app.contextStates()).at(-1)).toBe('closed');
  });
});
