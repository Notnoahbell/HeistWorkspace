// Client-generated IDs so offline creation never collides.
// crypto.randomUUID only exists in secure contexts (https/localhost), and the
// internal host may be plain http, so fall back to getRandomValues.

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function newId(size = 16): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let id = '';
  for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
  return id;
}
