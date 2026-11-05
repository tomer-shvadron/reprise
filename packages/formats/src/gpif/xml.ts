/**
 * A small, dependency-free XML parser for gpif. It builds an element tree and keeps only what
 * gpif uses: elements, attributes and character data (text and CDATA). Comments, processing
 * instructions and a DOCTYPE are skipped. It is strict about structure (matching tags, one
 * root, terminated constructs, known entities) and reports the line and column of the first
 * problem, so a damaged file fails with a position instead of a half-read score.
 */

export interface XmlElement {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: XmlElement[];
  /** Character data directly inside the element: text and CDATA, in order. */
  text: string;
  /** Offset of the `<` that opened the element, for `positionOf`. */
  readonly offset: number;
}

export class XmlError extends Error {
  override readonly name = 'XmlError';
  readonly line: number;
  readonly column: number;

  constructor(message: string, source: string, offset: number) {
    const { line, column } = positionOf(source, offset);
    super(`${message} at line ${String(line)}, column ${String(column)}`);
    this.line = line;
    this.column = column;
  }
}

/** 1-based line and column of `offset`, computed on demand so parsing never tracks lines. */
export function positionOf(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = source.indexOf('\n'); index !== -1 && index < offset;) {
    line++;
    lineStart = index + 1;
    index = source.indexOf('\n', lineStart);
  }
  return { line, column: offset - lineStart + 1 };
}

const ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

function decodeEntities(raw: string, source: string, offset: number): string {
  if (!raw.includes('&')) return raw;
  return raw.replaceAll(/&([^;&\s]*);?/g, (match: string, body: string, at: number) => {
    if (!match.endsWith(';'))
      throw new XmlError('Unterminated entity reference', source, offset + at);
    const named = ENTITIES[body];
    if (named !== undefined) return named;
    const code = body.startsWith('#x')
      ? Number.parseInt(body.slice(2), 16)
      : body.startsWith('#')
        ? Number.parseInt(body.slice(1), 10)
        : Number.NaN;
    if (!Number.isInteger(code) || code < 0 || code > 0x10_ff_ff) {
      throw new XmlError(`Unknown entity &${body};`, source, offset + at);
    }
    return String.fromCodePoint(code);
  });
}

function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function isNameEnd(code: number): boolean {
  return isSpace(code) || code === 0x2f || code === 0x3e || code === 0x3d || Number.isNaN(code);
}

function skipTo(source: string, from: number, terminator: string, what: string): number {
  const end = source.indexOf(terminator, from);
  if (end === -1) throw new XmlError(`Unterminated ${what}`, source, from);
  return end + terminator.length;
}

function readName(source: string, start: number): number {
  let end = start;
  while (end < source.length && !isNameEnd(source.charCodeAt(end))) end++;
  return end;
}

export function parseXml(source: string): XmlElement {
  const stack: XmlElement[] = [];
  let root: XmlElement | undefined;
  let pos = source.charCodeAt(0) === 0xfe_ff ? 1 : 0;

  while (pos < source.length) {
    const lt = source.indexOf('<', pos);
    const textEnd = lt === -1 ? source.length : lt;
    if (textEnd > pos) {
      const raw = source.slice(pos, textEnd);
      const top = stack.at(-1);
      if (top) {
        // Whitespace between child elements is layout, never data, in gpif.
        if (raw.trim() !== '') top.text += decodeEntities(raw, source, pos);
      } else if (raw.trim() !== '') {
        throw new XmlError('Text outside the root element', source, pos);
      }
    }
    if (lt === -1) break;

    if (source.startsWith('<?', lt)) {
      pos = skipTo(source, lt + 2, '?>', 'processing instruction');
    } else if (source.startsWith('<!--', lt)) {
      pos = skipTo(source, lt + 4, '-->', 'comment');
    } else if (source.startsWith('<![CDATA[', lt)) {
      const end = source.indexOf(']]>', lt + 9);
      if (end === -1) throw new XmlError('Unterminated CDATA section', source, lt);
      const top = stack.at(-1);
      if (!top) throw new XmlError('CDATA outside the root element', source, lt);
      top.text += source.slice(lt + 9, end);
      pos = end + 3;
    } else if (source.startsWith('<!', lt)) {
      const bracket = source.indexOf('[', lt);
      const close = source.indexOf('>', lt);
      pos =
        bracket !== -1 && bracket < close
          ? skipTo(source, bracket, ']>', 'document type declaration')
          : skipTo(source, lt + 2, '>', 'document type declaration');
    } else if (source.startsWith('</', lt)) {
      const nameEnd = readName(source, lt + 2);
      const name = source.slice(lt + 2, nameEnd);
      let close = nameEnd;
      while (close < source.length && isSpace(source.charCodeAt(close))) close++;
      if (source[close] !== '>') throw new XmlError(`Malformed closing tag </${name}`, source, lt);
      const open = stack.pop();
      if (!open) throw new XmlError(`Closing tag </${name}> without an open element`, source, lt);
      if (open.name !== name) {
        throw new XmlError(`Closing tag </${name}> does not match <${open.name}>`, source, lt);
      }
      pos = close + 1;
    } else {
      pos = readStartTag(source, lt, stack, (element) => {
        if (root) throw new XmlError('More than one root element', source, lt);
        root = element;
      });
    }
  }

  const unclosed = stack.at(-1);
  if (unclosed)
    throw new XmlError(`Element <${unclosed.name}> is never closed`, source, unclosed.offset);
  if (!root) throw new XmlError('No root element', source, source.length);
  return root;
}

function readStartTag(
  source: string,
  lt: number,
  stack: XmlElement[],
  setRoot: (element: XmlElement) => void,
): number {
  const nameEnd = readName(source, lt + 1);
  const name = source.slice(lt + 1, nameEnd);
  if (name === '') throw new XmlError('Expected an element name', source, lt);
  const attributes = new Map<string, string>();
  let pos = nameEnd;

  for (;;) {
    while (pos < source.length && isSpace(source.charCodeAt(pos))) pos++;
    if (pos >= source.length) throw new XmlError(`Unterminated tag <${name}`, source, lt);
    const code = source.charCodeAt(pos);
    if (code === 0x3e || (code === 0x2f && source.charCodeAt(pos + 1) === 0x3e)) break;

    const attributeEnd = readName(source, pos);
    const attribute = source.slice(pos, attributeEnd);
    if (attribute === '') throw new XmlError(`Malformed attribute in <${name}>`, source, pos);
    pos = attributeEnd;
    while (pos < source.length && isSpace(source.charCodeAt(pos))) pos++;
    if (source[pos] !== '=') {
      throw new XmlError(`Attribute ${attribute} in <${name}> has no value`, source, pos);
    }
    pos++;
    while (pos < source.length && isSpace(source.charCodeAt(pos))) pos++;
    const quote = source[pos];
    if (quote !== '"' && quote !== "'") {
      throw new XmlError(`Attribute ${attribute} in <${name}> is not quoted`, source, pos);
    }
    const valueEnd = source.indexOf(quote, pos + 1);
    if (valueEnd === -1) throw new XmlError(`Unterminated attribute ${attribute}`, source, pos);
    if (attributes.has(attribute)) {
      throw new XmlError(`Duplicate attribute ${attribute} in <${name}>`, source, pos);
    }
    attributes.set(attribute, decodeEntities(source.slice(pos + 1, valueEnd), source, pos + 1));
    pos = valueEnd + 1;
  }

  const selfClosing = source.charCodeAt(pos) === 0x2f;
  const element: XmlElement = { name, attributes, children: [], text: '', offset: lt };
  const parent = stack.at(-1);
  if (parent) parent.children.push(element);
  else setRoot(element);
  if (!selfClosing) stack.push(element);
  return pos + (selfClosing ? 2 : 1);
}
