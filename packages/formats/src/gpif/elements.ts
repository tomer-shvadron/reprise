import type { WarningSink } from './warnings';
import type { XmlElement } from './xml';

/** `Note[3]`, `Property[Slide]`: the element with the attribute that identifies it, if any. */
export function label(element: XmlElement): string {
  const id = element.attributes.get('id') ?? element.attributes.get('name');
  return id === undefined ? element.name : `${element.name}[${id}]`;
}

export function childPath(parent: string, element: XmlElement): string {
  return parent === '' ? label(element) : `${parent}/${label(element)}`;
}

/** The path without numeric ids, so one kind of loss folds into one warning. */
export function genericPath(path: string): string {
  return path.replaceAll(/\[-?\d+\]/g, '');
}

export function child(element: XmlElement, name: string): XmlElement | undefined {
  return element.children.find((candidate) => candidate.name === name);
}

export function childText(element: XmlElement, name: string): string | undefined {
  return child(element, name)?.text;
}

/** Space-separated list, as gpif writes id lists, tunings and RGB colours. */
export function splitList(text: string | undefined): string[] {
  if (text === undefined) return [];
  return text.split(/\s+/).filter((part) => part !== '');
}

export function parseIntOr(text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number.parseInt(text.trim(), 10);
  return Number.isNaN(value) ? fallback : value;
}

export function parseFloatOr(text: string | undefined, fallback: number): number {
  if (text === undefined) return fallback;
  const value = Number.parseFloat(text.trim());
  return Number.isNaN(value) ? fallback : value;
}

/** gpif booleans are `true`/`false`, but files from other writers use other casings. */
export function parseBool(text: string | undefined): boolean {
  return text?.trim().toLowerCase() === 'true';
}

/** True when an element says nothing: no attributes, no children and no character data. */
export function isBlank(element: XmlElement): boolean {
  return (
    element.children.length === 0 && element.attributes.size === 0 && element.text.trim() === ''
  );
}

export function unknownElement(sink: WarningSink, path: string): void {
  sink.warn('unknown-element', path, 'Element not recognised; ignored', genericPath(path));
}

export function notModelled(sink: WarningSink, path: string, what: string): void {
  sink.warn('not-modelled', path, `${what}: not modelled, dropped`, genericPath(path));
}

export function unknownValue(sink: WarningSink, path: string, value: string): void {
  sink.warn(
    'unknown-value',
    path,
    `Value "${value}" not recognised; ignored`,
    `${genericPath(path)}=${value}`,
  );
}
