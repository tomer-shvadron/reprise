import { act, screen, waitFor } from '@testing-library/react';
import { MAX_FILE_BYTES, write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { renderWithServices } from '@/test/render';

import { DropZone } from './drop-zone';

function dragEvent(type: string, files: File[], types: string[] = ['Files']) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { types, files } });
  return event;
}

async function riff(): Promise<File> {
  const { bytes } = await write(score().title('Riff').build(), 'reprise');
  return new File([bytes.slice()], 'riff.reprise');
}

describe('DropZone', () => {
  it('shows the overlay while files are dragged over, and opens the first dropped one', async () => {
    const { services } = renderWithServices(<DropZone />);
    const file = await riff();

    act(() => {
      window.dispatchEvent(dragEvent('dragenter', [file]));
    });
    expect(screen.getByText('Drop to open')).toBeInTheDocument();
    const over = dragEvent('dragover', [file]);
    window.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);

    const drop = dragEvent('drop', [file, new File(['x'], 'other.gp5')]);
    act(() => {
      window.dispatchEvent(drop);
    });

    expect(drop.defaultPrevented).toBe(true);
    expect(screen.queryByText('Drop to open')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(services.document.getState().score?.meta.title).toBe('Riff');
    });
    expect(services.document.getState().file?.name).toBe('riff.reprise');
  });

  it('ignores drags that carry no files', () => {
    renderWithServices(<DropZone />);

    const over = dragEvent('dragover', [], ['text/plain']);
    act(() => {
      window.dispatchEvent(dragEvent('dragenter', [], ['text/plain']));
      window.dispatchEvent(over);
    });

    expect(over.defaultPrevented).toBe(false);
    expect(screen.queryByText('Drop to open')).not.toBeInTheDocument();
  });

  it('refuses a file over the size limit before reading it', () => {
    const { services } = renderWithServices(<DropZone />);
    const huge = new File(['x'], 'huge.gp5');
    Object.defineProperty(huge, 'size', { value: MAX_FILE_BYTES + 1 });

    act(() => {
      window.dispatchEvent(dragEvent('drop', [huge]));
    });

    expect(services.document.getState().error).toMatchObject({
      action: 'open',
      fileName: 'huge.gp5',
      code: 'too-large',
    });
  });
});
