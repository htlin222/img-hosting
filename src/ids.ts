const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

const randomFrom = (alphabet: string, length: number): string => {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
};

export const newImageId = () => randomFrom(ALPHABET, 7);
export const newDeleteHash = () => randomFrom(ALPHABET, 15);

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  // Copy into a fresh ArrayBuffer so SubtleCrypto doesn't see a
  // SharedArrayBuffer view (which it refuses).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};
