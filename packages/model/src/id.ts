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

// One `getRandomValues` call per id dominated import time on large files.
const POOL_SIZE = 1024;
const pool = new Uint8Array(POOL_SIZE);
let poolIndex = POOL_SIZE;

function nextByte(): number {
  if (poolIndex === POOL_SIZE) {
    crypto.getRandomValues(pool);
    poolIndex = 0;
  }
  const byte = pool[poolIndex] ?? 0;
  poolIndex += 1;
  return byte;
}

export function newId(): Id {
  let id = '';
  while (id.length < ID_LENGTH) {
    const byte = nextByte();
    if (byte < UNBIASED_LIMIT) id += ALPHABET.charAt(byte % ALPHABET.length);
  }
  return id;
}
