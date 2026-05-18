export type SniffResult = {
  mime: string;
  ext: string;
  width: number | null;
  height: number | null;
};

const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const u32be = (b: Uint8Array, o: number) =>
  ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) =>
  (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

const asciiEq = (b: Uint8Array, o: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
};

const sniffPng = (b: Uint8Array): SniffResult | null => {
  if (b.length < 24) return null;
  // 89 50 4E 47 0D 0A 1A 0A
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return null;
  // IHDR starts at byte 8; width @ 16, height @ 20 (big-endian)
  return { mime: 'image/png', ext: 'png', width: u32be(b, 16), height: u32be(b, 20) };
};

const sniffGif = (b: Uint8Array): SniffResult | null => {
  if (b.length < 10) return null;
  if (!(asciiEq(b, 0, 'GIF87a') || asciiEq(b, 0, 'GIF89a'))) return null;
  return {
    mime: 'image/gif',
    ext: 'gif',
    width: b[6] | (b[7] << 8),
    height: b[8] | (b[9] << 8),
  };
};

const sniffJpeg = (b: Uint8Array): SniffResult | null => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i < b.length - 9) {
    if (b[i] !== 0xff) return { mime: 'image/jpeg', ext: 'jpg', width: null, height: null };
    const marker = b[i + 1];
    // SOF markers (excluding DHT 0xC4, DAC 0xCC, DNL 0xC8)
    if (
      (marker >= 0xc0 && marker <= 0xcf) &&
      marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    ) {
      const height = u16be(b, i + 5);
      const width = u16be(b, i + 7);
      return { mime: 'image/jpeg', ext: 'jpg', width, height };
    }
    const segLen = u16be(b, i + 2);
    i += 2 + segLen;
  }
  return { mime: 'image/jpeg', ext: 'jpg', width: null, height: null };
};

const sniffWebp = (b: Uint8Array): SniffResult | null => {
  if (b.length < 30) return null;
  if (!asciiEq(b, 0, 'RIFF') || !asciiEq(b, 8, 'WEBP')) return null;
  const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (fourcc === 'VP8 ') {
    // VP8 (lossy): width and height are 14-bit little-endian at offsets 26/28
    const width = (b[26] | (b[27] << 8)) & 0x3fff;
    const height = (b[28] | (b[29] << 8)) & 0x3fff;
    return { mime: 'image/webp', ext: 'webp', width, height };
  }
  if (fourcc === 'VP8L') {
    // VP8L (lossless): width-1 (14 bits), height-1 (14 bits) starting at byte 21
    const bits = u32le(b, 21);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { mime: 'image/webp', ext: 'webp', width, height };
  }
  if (fourcc === 'VP8X') {
    // extended: width-1 (24-bit LE) @ 24, height-1 @ 27
    const width = (b[24] | (b[25] << 8) | (b[26] << 16)) + 1;
    const height = (b[27] | (b[28] << 8) | (b[29] << 16)) + 1;
    return { mime: 'image/webp', ext: 'webp', width, height };
  }
  return { mime: 'image/webp', ext: 'webp', width: null, height: null };
};

export const sniffImage = (bytes: Uint8Array): SniffResult | null => {
  return sniffPng(bytes) ?? sniffJpeg(bytes) ?? sniffGif(bytes) ?? sniffWebp(bytes);
};

export const extFromMime = (mime: string): string => {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'bin';
  }
};
