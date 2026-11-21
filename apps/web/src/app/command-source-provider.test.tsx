import { act, render } from '@testing-library/react';
import { Profiler, useState } from 'react';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { CommandSourceProvider } from './command-source-provider';
import { useCommand } from './use-command';

describe('CommandSourceProvider', () => {
  it('re-renders only the context consumers when edit mode toggles', () => {
    const services = createTestServices();
    const renders = { shell: 0, plain: 0, consumer: 0 };
    function Consumer() {
      renders.consumer += 1;
      return <p>{useCommand('transport.slowDown').keys ?? 'none'}</p>;
    }
    function Plain() {
      renders.plain += 1;
      return <p>score</p>;
    }
    // As `App` does: the slot elements are made once by a parent the provider does not re-render.
    function Shell() {
      renders.shell += 1;
      const [registry] = useState(() => createAppRegistry(services, 'mac'));
      return (
        <CommandSourceProvider
          registry={registry}
          keyboard="mac"
          settings={services.settings}
          editing={services.editing}
        >
          <Plain />
          <Consumer />
        </CommandSourceProvider>
      );
    }
    const { container } = render(
      <Profiler id="shell" onRender={() => undefined}>
        <Shell />
      </Profiler>,
    );
    expect(container).toHaveTextContent('[');
    const before = { ...renders };
    act(() => {
      services.editing.getState().setEditing(true);
    });
    expect(container).toHaveTextContent('none');
    expect(renders.shell).toBe(before.shell);
    expect(renders.plain).toBe(before.plain);
    expect(renders.consumer).toBeGreaterThan(before.consumer);
  });
});
