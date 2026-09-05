import { toRgb, quantize } from "./palette";
import type { Grid2D } from "./types";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// Raw deflate stream using stored (uncompressed) blocks.
function zlibStored(data: Uint8Array): Uint8Array {
  const out: number[] = [0x78, 0x01];
  let offset = 0;
  while (offset < data.length) {
    const len = Math.min(65535, data.length - offset);
    const final = offset + len >= data.length;
    out.push(final ? 1 : 0);
    out.push(len & 0xff, (len >>> 8) & 0xff);
    const nlen = (~len) & 0xffff;
    out.push(nlen & 0xff, (nlen >>> 8) & 0xff);
    for (let i = 0; i < len; i++) out.push(data[offset + i]);
    offset += len;
  }
  const ad = adler32(data);
  out.push((ad >>> 24) & 0xff, (ad >>> 16) & 0xff, (ad >>> 8) & 0xff, ad & 0xff);
  return new Uint8Array(out);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(4 + typeBytes.length + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 4 + typeBytes.length);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  dv.setUint32(4 + typeBytes.length + data.length, crc32(crcInput));
  return out;
}

function textChunk(keyword: string, value: string): Uint8Array {
  const key = new TextEncoder().encode(keyword);
  const val = new TextEncoder().encode(value);
  const data = new Uint8Array(key.length + 1 + val.length);
  data.set(key, 0);
  data[key.length] = 0;
  data.set(val, key.length + 1);
  return chunk("tEXt", data);
}

export interface PngMeta {
  format?: string;
  version?: string;
  title?: string;
}

export function encodePNG(grid: Grid2D, meta: PngMeta = {}): Uint8Array {
  const { width, height, data } = grid;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = new Uint8Array(13);
  const dv = new DataView(ihdrData.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  // scanlines with filter byte 0
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = toRgb(data[y * width + x]);
      const o = rowStart + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }

  const parts: Uint8Array[] = [sig];
  parts.push(chunk("IHDR", ihdrData));
  if (meta.format) parts.push(textChunk("format", meta.format));
  if (meta.version) parts.push(textChunk("version", meta.version));
  if (meta.title) parts.push(textChunk("title", meta.title));
  parts.push(chunk("IDAT", zlibStored(raw)));
  parts.push(chunk("IEND", new Uint8Array(0)));

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function gridFromRGBA(rgba: Uint8ClampedArray, width: number, height: number): Grid2D {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[y * width + x] = quantize(rgba[i], rgba[i + 1], rgba[i + 2]);
    }
  }
  return { data, width, height };
}

function readUint32(bytes: Uint8Array, off: number): number {
  return (
    ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0
  );
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function unfilter(bytes: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = bytes[y * (stride + 1)];
    const row = y * stride;
    const srcRow = y * (stride + 1) + 1;
    const prevRow = (y - 1) * stride;
    for (let i = 0; i < stride; i++) {
      const raw = bytes[srcRow + i];
      const left = i >= bpp ? out[row + i - bpp] : 0;
      const up = y > 0 ? out[prevRow + i] : 0;
      const upLeft = y > 0 && i >= bpp ? out[prevRow + i - bpp] : 0;
      let v: number;
      switch (filter) {
        case 0: v = raw; break;
        case 1: v = raw + left; break;
        case 2: v = raw + up; break;
        case 3: v = raw + ((left + up) >> 1); break;
        case 4: v = raw + paeth(left, up, upLeft); break;
        default: v = raw; break;
      }
      out[row + i] = v & 0xff;
    }
  }
  return out;
}

export function decodePNG(bytes: Uint8Array): Grid2D {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) throw new Error("Неверная сигнатура PNG");
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: number[] = [];

  while (pos < bytes.length) {
    const len = readUint32(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      colorType = data[9];
    } else if (type === "IDAT") {
      for (let i = 0; i < data.length; i++) idat.push(data[i]);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }

  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`Неподдерживаемый цветовой тип PNG: ${colorType}`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const inflated = decompress(new Uint8Array(idat));
  const raw = unfilter(inflated, width, height, bpp);

  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * width * bpp + x * bpp;
      data[y * width + x] = quantize(raw[o], raw[o + 1], raw[o + 2]);
    }
  }
  return { data, width, height };
}

function decompress(data: Uint8Array): Uint8Array {
  let pos = 2; // zlib header
  const out: number[] = [];
  while (pos < data.length) {
    const bfinal = data[pos] & 1;
    const btype = (data[pos] >> 1) & 3;
    pos++;
    if (btype === 0) {
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < len; i++) out.push(data[pos + i]);
      pos += len;
    } else {
      throw new Error("Неподдерживаемый тип deflate-блока");
    }
    if (bfinal) break;
  }
  return new Uint8Array(out);
}
