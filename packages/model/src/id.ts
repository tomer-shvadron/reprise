import { z } from 'zod';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const ID_LENGTH = 12;
export const ID_PATTERN = /^[0-9A-Za-z]{12}$/;

// Bytes at or above this are rejected so `byte % 62` stays uniform.
const UNBIASED_LIMIT = 256 - (256 % ALPHABET.length);

// Declared locally rather than through the DOM or Node lib so the package stays lib-free;
// both runtimes provide the global.
declare const crypto: { getRandomValues(array: Uint8Array): Uint8Array };

export const IdSchema = z.string().regex(ID_PATTERN);
export type Id = z.infer<typeof IdSchema>;

export function newId(): Id {
  let id = '';
  const bytes = new Uint8Array(ID_LENGTH * 2);
  while (id.length < ID_LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < UNBIASED_LIMIT) {
        id += ALPHABET.charAt(byte % ALPHABET.length);
        if (id.length === ID_LENGTH) break;
      }
    }
  }
  return id;
}
