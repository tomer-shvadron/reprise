import { describe, expect, it } from 'vitest';

import type { KeyboardPlatform } from './keyboard';
import { readKeyEvent, type KeyEventInfo, type KeyRead } from './record-key';

const event = (init: Partial<KeyEventInfo> & { key: string }): KeyEventInfo => ({
  code: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  ...init,
});

const read = (init: Partial<KeyEventInfo> & { key: string }, platform: KeyboardPlatform = 'mac') =>
  readKeyEvent(event(init), platform, [{ key: 'c', mod: true }]);

const binding = (result: KeyRead) => {
  if (result.kind !== 'key') throw new Error(`expected a key, got ${result.kind}`);
  return result.binding;
};

describe('readKeyEvent', () => {
  it('records letters lowercased, with Shift held', () => {
    expect(binding(read({ key: 'S', code: 'KeyS', shiftKey: true, metaKey: true }))).toEqual({
      key: 's',
      mod: true,
      shift: true,
      code: 'KeyS',
    });
  });

  it('records digits, and a shifted symbol by its character', () => {
    expect(binding(read({ key: '3', code: 'Digit3' }))).toMatchObject({ key: '3' });
    expect(binding(read({ key: '@', code: 'Digit2', shiftKey: true }))).toMatchObject({
      key: '2',
      shift: true,
    });
    expect(binding(read({ key: '?', code: 'Slash', shiftKey: true }))).toMatchObject({
      key: '?',
      shift: true,
    });
  });

  it('records the Latin key of the physical key on a layout that prints something else', () => {
    expect(binding(read({ key: 'ש', code: 'KeyA' }, 'other'))).toMatchObject({ key: 'a' });
    expect(binding(read({ key: 'é', code: 'Digit2' }, 'other'))).toMatchObject({ key: '2' });
    expect(binding(read({ key: 'ö', code: 'Semicolon' }, 'other'))).toMatchObject({ key: 'ö' });
  });

  it('records brackets by their physical key', () => {
    expect(binding(read({ key: ']', code: 'BracketLeft' }, 'other'))).toMatchObject({ key: '[' });
  });

  it('turns an Option letter on a Mac into the letter with Alt, and refuses an Option symbol', () => {
    expect(binding(read({ key: 'ç', code: 'KeyC', altKey: true }))).toMatchObject({
      key: 'c',
      alt: true,
    });
    expect(read({ key: '…', code: 'Semicolon', altKey: true })).toEqual({
      kind: 'refuse',
      reason: 'option-symbol',
    });
  });

  it('records named keys, Space and Enter', () => {
    for (const key of ['F5', 'ArrowLeft', 'Enter', 'Delete', ' ']) {
      expect(binding(read({ key }))).toMatchObject({ key });
    }
  });

  it('waits on a modifier, a repeat and a composition', () => {
    expect(read({ key: 'Shift', shiftKey: true })).toEqual({ kind: 'wait' });
    expect(read({ key: 'a', code: 'KeyA', repeat: true })).toEqual({ kind: 'wait' });
    expect(read({ key: 'a', code: 'KeyA', isComposing: true })).toEqual({ kind: 'wait' });
    expect(read({ key: 'Process' })).toEqual({ kind: 'wait' });
  });

  it('cancels on Escape and leaves on Tab, with any modifiers', () => {
    expect(read({ key: 'Escape', shiftKey: true })).toEqual({ kind: 'cancel' });
    expect(read({ key: 'Tab' })).toEqual({ kind: 'leave' });
    expect(read({ key: 'Tab', shiftKey: true })).toEqual({ kind: 'leave' });
  });

  it('refuses a dead key', () => {
    expect(read({ key: 'Dead', code: 'Quote' })).toEqual({ kind: 'refuse', reason: 'unsupported' });
  });

  it('refuses Control on a Mac and the Windows key elsewhere', () => {
    expect(read({ key: 'k', code: 'KeyK', ctrlKey: true })).toEqual({
      kind: 'refuse',
      reason: 'control',
    });
    expect(read({ key: 'k', code: 'KeyK', metaKey: true }, 'other')).toEqual({
      kind: 'refuse',
      reason: 'windows-key',
    });
  });

  it('refuses the reserved keys of each platform, select all and a native command key', () => {
    const reserved = (key: string, init: Partial<KeyEventInfo>, platform: KeyboardPlatform) =>
      read({ key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init }, platform);
    for (const key of ['q', 'w', 'h', 'm']) {
      expect(reserved(key, { metaKey: true }, 'mac')).toEqual({
        kind: 'refuse',
        reason: 'reserved',
      });
    }
    expect(reserved('h', { metaKey: true, altKey: true }, 'mac')).toMatchObject({
      reason: 'reserved',
    });
    expect(reserved('F4', { altKey: true }, 'other')).toMatchObject({ reason: 'reserved' });
    expect(reserved('w', { ctrlKey: true }, 'other')).toMatchObject({ reason: 'reserved' });
    expect(reserved('F10', {}, 'other')).toMatchObject({ reason: 'reserved' });
    expect(reserved('a', { metaKey: true }, 'mac')).toMatchObject({ reason: 'select-all' });
    expect(reserved('c', { metaKey: true }, 'mac')).toMatchObject({ reason: 'native' });
    // Ctrl+W is a plain key on a Mac.
    expect(binding(reserved('w', { metaKey: true, shiftKey: true }, 'mac'))).toMatchObject({
      key: 'w',
    });
  });
});
