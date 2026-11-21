/**
 * The key half of `pnpm check:files`: the detected key of every file, written to
 * `.check-files/insights.md` by its `local-N` label only, with an accuracy figure when
 * `local-tabs/keys.json` lists true keys. The logic is `test/key-report.ts`; this file only runs it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { read } from '@reprise/formats';
import { describe, inject, it } from 'vitest';

import { detectKey } from './key';
import { keyName, scaleName } from './key-names';
import { noteTableOf } from './note-table';
import { KEYS_FILE, parseTrueKeys, renderKeyReport, trueKeyOf } from './test/key-report';
import type { KeyReportRow } from './test/key-report';

declare module 'vitest' {
  interface ProvidedContext {
    checkFiles: { file: string; absolute: string; hash?: string; readError?: string }[];
  }
}

// The same root the other checks use: `apps/web/src/lib/insights` is five levels down.
const ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('key detection on the real files', () => {
  it('writes .check-files/insights.md', async () => {
    const keysPath = join(ROOT, KEYS_FILE);
    const found = existsSync(keysPath);
    const listed = found
      ? parseTrueKeys(JSON.parse(readFileSync(keysPath, 'utf8')) as unknown)
      : parseTrueKeys({});
    const rows: KeyReportRow[] = [];
    for (const file of inject('checkFiles')) {
      const label = file.hash === undefined ? file.file : `${file.file} (sha256 ${file.hash})`;
      if (file.readError !== undefined) {
        rows.push({ label, detected: 'unreadable' });
        continue;
      }
      const { score } = await read(new Uint8Array(readFileSync(file.absolute)));
      const fileKey = score.masterBars[0]?.keySignature;
      const result = detectKey(noteTableOf(score), fileKey ? { fileKey } : {});
      const expected = trueKeyOf(listed.keys, file);
      const row: KeyReportRow = result.found
        ? {
            label,
            detected: result.name,
            tonic: result.tonic,
            quality: result.quality,
            confidence: result.confidence,
            correlation: result.correlation,
            runnerUp: keyName(result.runnerUp.tonic, result.runnerUp.quality),
          }
        : { label, detected: 'not enough notes' };
      if (result.found && result.agreesWithFile !== undefined)
        row.agreesWithFile = result.agreesWithFile;
      if (result.found && result.scale)
        row.scale = scaleName(result.tonic, result.scale.scale, fileKey);
      if (expected) {
        row.expected = expected;
        row.expectedName = keyName(expected.tonic, expected.quality);
      }
      rows.push(row);
    }
    const out = process.env['REPRISE_CHECK_OUT'] ?? join(ROOT, '.check-files');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'insights.md'), renderKeyReport(rows, listed.invalid, found));
  });
});
