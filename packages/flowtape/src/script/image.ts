import { deflateSync, inflateSync } from 'node:zlib';

/** Jev image limits: each side 280-1568 px, area 78400-2458624 px. */
export const MIN_SIDE = 280;
export const MAX_SIDE = 1568;
export const MAX_AREA = 2_458_624;
const BACKGROUND = [240, 240, 240, 255];

export interface FittedImage {
  png: Buffer;
  width: number;
  height: number;
  /** Source pixels to fitted pixels. 1 when not scaled. */
  scale: number;
  /** Padding left and above the (scaled) source, in fitted pixels. */
  offsetX: number;
  offsetY: number;
}

interface Raster {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Buffer;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG (what Playwright writes). */
export function decodePng(png: Buffer): Raster {
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let pos = 8; pos < png.length; ) {
    const length = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colorType, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) throw new Error('Unsupported PNG: need 8-bit RGB or RGBA, not interlaced');
      channels = colorType === 2 ? 3 : 4;
    } else if (type === 'IDAT') idat.push(data);
    pos += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? rows[y * stride + x - channels] : 0;
      const up = y > 0 ? rows[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? rows[(y - 1) * stride + x - channels] : 0;
      const add = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (add === undefined) throw new Error(`Bad PNG filter ${filter}`);
      rows[y * stride + x] = (value + add) & 0xff;
    }
  }
  const data = Buffer.alloc(width * height * 4, 255);
  for (let i = 0; i < width * height; i++) for (let c = 0; c < channels; c++) data[i * 4 + c] = rows[i * channels + c];
  return { width, height, data };
}

export function encodePng({ width, height, data }: Raster): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Nearest-neighbour resize. Fine for the small screenshots flowtape keeps. */
function resize(src: Raster, width: number, height: number): Raster {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(src.height - 1, Math.floor((y * src.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x * src.width) / width));
      src.data.copy(data, (y * width + x) * 4, (sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4);
    }
  }
  return { width, height, data };
}

/** Scale down to the Jev maximums, then centre on a neutral background to reach the minimum side. */
export function fitImage(png: Buffer): FittedImage {
  const src = decodePng(png);
  const scale = Math.min(1, MAX_SIDE / src.width, MAX_SIDE / src.height, Math.sqrt(MAX_AREA / (src.width * src.height)));
  // Floor so the scaled size can never exceed a limit.
  const scaled = scale < 1 ? resize(src, Math.max(1, Math.floor(src.width * scale)), Math.max(1, Math.floor(src.height * scale))) : src;
  const width = Math.max(MIN_SIDE, scaled.width);
  const height = Math.max(MIN_SIDE, scaled.height);
  // Both sides at least 280 gives an area of at least 78400.
  if (width === scaled.width && height === scaled.height) return { png: scale < 1 ? encodePng(scaled) : png, width, height, scale, offsetX: 0, offsetY: 0 };
  const offsetX = Math.floor((width - scaled.width) / 2);
  const offsetY = Math.floor((height - scaled.height) / 2);
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(BACKGROUND, i * 4);
  for (let y = 0; y < scaled.height; y++) scaled.data.copy(data, ((y + offsetY) * width + offsetX) * 4, y * scaled.width * 4, (y + 1) * scaled.width * 4);
  return { png: encodePng({ width, height, data }), width, height, scale, offsetX, offsetY };
}
