import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import-x/no-relative-packages -- the visual suite's PDF reader, which scripts/desktop/print-pdfs.ts shares
import { pdfPages } from '../../apps/web/e2e/visual/test/pdf-pages.node.ts';

const twoPages = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 /MediaBox [0 0 1 1] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.5 842.25] >>
endobj
4 0 obj
<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>
endobj
trailer << /Root 1 0 R >>
%%EOF`;

describe('pdfPages', () => {
  it('counts the page objects, not the page tree, and reads each MediaBox', () => {
    expect(pdfPages(new TextEncoder().encode(twoPages))).toEqual({
      count: 2,
      mediaBoxes: [
        [595.5, 842.25],
        [612, 792],
      ],
    });
  });

  it('refuses a PDF whose pages it cannot see', () => {
    const packed = '%PDF-1.5\n1 0 obj\n<< /Type /ObjStm /N 3 >>\nstream\nx\nendstream\nendobj\n';
    expect(() => pdfPages(new TextEncoder().encode(packed))).toThrow(/object streams/);
  });
});
