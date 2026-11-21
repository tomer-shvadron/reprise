import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import type { KeyboardPlatform } from './keyboard';
import {
  bindCommand,
  CommandSourceContext,
  useCommand,
  useCommandSource,
  type RegisteredCommandId,
} from './use-command';

function source(keyboard: KeyboardPlatform) {
  const services = createTestServices();
  return { services, source: { registry: createAppRegistry(services, keyboard), keyboard } };
}

const shown = (keyboard: KeyboardPlatform, id: RegisteredCommandId) => {
  const { source: s } = source(keyboard);
  return bindCommand(s, id);
};

describe('bindCommand', () => {
  it('lists redo and its alias per platform', () => {
    expect(shown('mac', 'edit.redo').keys).toBe('⇧⌘Z');
    expect(shown('mac', 'edit.redo').bindings).toHaveLength(1);
    const other = shown('other', 'edit.redo');
    expect(other.bindings).toHaveLength(2);
    expect(other.keys).toBe('Ctrl+Shift+Z');
    expect(other.ariaKeys).toBe('Control+Shift+Z Control+Y');
    expect(other.spoken).toBe('Ctrl+Shift+Z or Ctrl+Y');
  });

  it('resolves a Windows twin from the command it shadows', () => {
    const add = shown('other', 'track.add');
    expect(add.bindings.length).toBeGreaterThan(0);
    expect(add.bindings).toEqual(shown('other', 'track.addWindows').bindings);
  });

  it('drops keys an active context takes over, and gives them back', () => {
    const { services, source: s } = source('mac');
    expect(bindCommand(s, 'transport.stop').ariaKeys).toContain('Enter');
    services.editing.getState().setEditing(true);
    expect(bindCommand(s, 'transport.stop').ariaKeys ?? '').not.toContain('Enter');
    expect(bindCommand(s, 'transport.slowDown').keys).toBeUndefined();
    services.editing.getState().setEditing(false);
    expect(bindCommand(s, 'transport.stop').ariaKeys).toContain('Enter');
    expect(bindCommand(s, 'transport.slowDown').keys).toBe('[');
  });

  it('re-renders a consumer when edit mode starts or ends', () => {
    const services = createTestServices();
    const registry = createAppRegistry(services, 'mac');
    const Wrapper = ({ children }: { children: ReactNode }) => {
      const value = useCommandSource(registry, 'mac', services.settings, services.editing);
      return <CommandSourceContext value={value}>{children}</CommandSourceContext>;
    };
    const { result } = renderHook(() => useCommand('transport.slowDown'), { wrapper: Wrapper });
    expect(result.current.keys).toBe('[');
    act(() => {
      services.editing.getState().setEditing(true);
    });
    expect(result.current.keys).toBeUndefined();
  });
});
