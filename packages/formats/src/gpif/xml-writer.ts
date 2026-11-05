/** Tab, line feed and carriage return are the only C0 controls XML 1.0 allows. */
const ALLOWED_CONTROLS = new Set([0x09, 0x0a, 0x0d]);

const isHighSurrogate = (code: number): boolean => code >= 0xd8_00 && code <= 0xdb_ff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc_00 && code <= 0xdf_ff;

/**
 * The text without the characters XML 1.0 cannot carry at all, escaped or not: C0 controls
 * other than tab, line feed and carriage return, lone surrogates, and U+FFFE and U+FFFF.
 */
function sanitize(text: string): string {
  let result = '';
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (isHighSurrogate(code)) {
      if (isLowSurrogate(text.charCodeAt(index + 1))) {
        result += text.slice(index, index + 2);
        index++;
      }
      continue;
    }
    if (isLowSurrogate(code) || code === 0xff_fe || code === 0xff_ff) continue;
    if (code < 0x20 && !ALLOWED_CONTROLS.has(code)) continue;
    result += text.charAt(index);
  }
  return result;
}

/** True when the string holds a character XML cannot represent, which the writer removes. */
export function hasInvalidXmlCharacters(text: string): boolean {
  return sanitize(text) !== text;
}

function escapeText(text: string): string {
  return sanitize(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeText(text).replaceAll('"', '&quot;');
}

/**
 * A CDATA section keeps text verbatim, including leading and trailing whitespace the reader's
 * parser drops from plain text. `]]>` cannot appear inside one, so it is split across two.
 */
function cdata(text: string): string {
  return `<![CDATA[${sanitize(text).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
}

export type Attributes = Readonly<Record<string, string>>;

function attributeText(attributes: Attributes | undefined): string {
  if (!attributes) return '';
  let result = '';
  for (const [name, value] of Object.entries(attributes)) {
    result += ` ${name}="${escapeAttribute(value)}"`;
  }
  return result;
}

/**
 * A forward-only XML serializer for the gpif vocabulary: elements, attributes, escaped text and
 * CDATA, one element per line as Guitar Pro writes them. It does not check nesting beyond
 * `close` naming the element it closes; the writer above it owns the structure.
 */
export class XmlWriter {
  readonly #parts: string[] = [];
  readonly #open: string[] = [];

  open(name: string, attributes?: Attributes): this {
    this.#parts.push(`<${name}${attributeText(attributes)}>\n`);
    this.#open.push(name);
    return this;
  }

  close(name: string): this {
    const top = this.#open.pop();
    if (top !== name)
      throw new Error(`XmlWriter: closing <${name}> while <${String(top)}> is open`);
    this.#parts.push(`</${name}>\n`);
    return this;
  }

  /** `<name/>`, a flag element whose presence is the value. */
  empty(name: string, attributes?: Attributes): this {
    this.#parts.push(`<${name}${attributeText(attributes)} />\n`);
    return this;
  }

  /** An element holding escaped text: numbers, enumerations, id lists. */
  text(name: string, value: string | number, attributes?: Attributes): this {
    this.#parts.push(
      `<${name}${attributeText(attributes)}>${escapeText(String(value))}</${name}>\n`,
    );
    return this;
  }

  /** An element holding free text as CDATA, as Guitar Pro writes names, lyrics and labels. */
  cdata(name: string, value: string, attributes?: Attributes): this {
    this.#parts.push(`<${name}${attributeText(attributes)}>${cdata(value)}</${name}>\n`);
    return this;
  }

  /** The XML declaration, first in a document. */
  declaration(): this {
    this.#parts.push('<?xml version="1.0" encoding="utf-8"?>\n');
    return this;
  }

  /** Appends a fragment built separately, so sections can be written in any order. */
  append(fragment: XmlWriter): this {
    this.#parts.push(fragment.toString());
    return this;
  }

  toString(): string {
    if (this.#open.length > 0) {
      throw new Error(`XmlWriter: <${this.#open.join('>, <')}> left open`);
    }
    return this.#parts.join('');
  }
}
