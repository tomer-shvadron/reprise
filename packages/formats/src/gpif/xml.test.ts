import { describe, expect, it } from 'vitest';

import { XmlError, parseXml } from './xml';

function failure(source: string): XmlError {
  try {
    parseXml(source);
  } catch (error) {
    if (error instanceof XmlError) return error;
    throw error;
  }
  throw new Error('parseXml did not fail');
}

describe('parseXml', () => {
  it('builds the element tree with attributes and text', () => {
    const root = parseXml(
      '<?xml version="1.0" encoding="utf-8"?>\n<!-- note -->\n<A x="1" y=\'two\'>\n  <B>text</B>\n  <C/>\n  <D a="&lt;&amp;&#65;&#x42;"/>\n</A>\n',
    );
    expect(root.name).toBe('A');
    expect(Object.fromEntries(root.attributes)).toEqual({ x: '1', y: 'two' });
    expect(root.children.map((child) => child.name)).toEqual(['B', 'C', 'D']);
    expect(root.children[0]?.text).toBe('text');
    expect(root.children[2]?.attributes.get('a')).toBe('<&AB');
    expect(root.text).toBe('');
  });

  it('keeps CDATA verbatim, markup and entities included', () => {
    const root = parseXml('<A><![CDATA[<b>&amp; ]]]]><![CDATA[>]]></A>');
    expect(root.text).toBe('<b>&amp; ]]>');
  });

  it('accepts a greater-than sign in text, as gpif writes "0>"', () => {
    expect(parseXml('<MultiVoice>0></MultiVoice>').text).toBe('0>');
  });

  it('skips a DOCTYPE, including an internal subset', () => {
    expect(parseXml('<!DOCTYPE a [ <!ENTITY x "y"> ]><a/>').name).toBe('a');
  });

  it.each([
    ['<A><B></A>', 'Closing tag </A> does not match <B>', 1, 7],
    ['<A>\n  <B>\n</A>', 'Closing tag </A> does not match <B>', 3, 1],
    ['<A><B>', 'Element <B> is never closed', 1, 4],
    ['<A>&nope;</A>', 'Unknown entity &nope;', 1, 4],
    ['<A>a & b</A>', 'Unterminated entity reference', 1, 6],
    ['<A/><B/>', 'More than one root element', 1, 5],
    ['text<A/>', 'Text outside the root element', 1, 1],
    ['<A x=1/>', 'Attribute x in <A> is not quoted', 1, 6],
    ['<A x="1" x="2"/>', 'Duplicate attribute x in <A>', 1, 12],
    ['<A><![CDATA[x</A>', 'Unterminated CDATA section', 1, 4],
    ['<A><!-- x</A>', 'Unterminated comment', 1, 8],
    ['<A', 'Unterminated tag <A', 1, 1],
    ['</A>', 'Closing tag </A> without an open element', 1, 1],
    ['', 'No root element', 1, 1],
  ])('rejects %j with its position', (source, message, line, column) => {
    const error = failure(source);
    expect(error.message).toBe(`${message} at line ${String(line)}, column ${String(column)}`);
    expect([error.line, error.column]).toEqual([line, column]);
  });
});
