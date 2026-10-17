import { describe, expect, it } from 'vitest';
import { decodePng, encodePng, fitImage, MAX_AREA, MAX_SIDE, MIN_SIDE } from '../src/script/image';

function solid(width: number, height: number, rgba = [10, 20, 30, 255]): Buffer {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return encodePng({ width, height, data });
}

describe('fitImage', () => {
  it('pads a small crop to at least 280x280 and centres it', () => {
    const fit = fitImage(solid(60, 30));
    expect(fit.width).toBeGreaterThanOrEqual(MIN_SIDE);
    expect(fit.height).toBeGreaterThanOrEqual(MIN_SIDE);
    expect(fit.width * fit.height).toBeGreaterThanOrEqual(78400);
    const out = decodePng(fit.png);
    expect([out.width, out.height]).toEqual([fit.width, fit.height]);
    // Source pixel lands at the offset. The corner is background.
    const at = (x: number, y: number) => Array.from(out.data.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 4));
    expect(at(fit.offsetX, fit.offsetY)).toEqual([10, 20, 30, 255]);
    expect(at(0, 0)).toEqual([240, 240, 240, 255]);
    expect(fit.scale).toBe(1);
  });

  it('scales a large screenshot down inside the limits', () => {
    const fit = fitImage(solid(2000, 1000));
    expect(fit.width).toBeLessThanOrEqual(MAX_SIDE);
    expect(fit.height).toBeLessThanOrEqual(MAX_SIDE);
    expect(fit.width * fit.height).toBeLessThanOrEqual(MAX_AREA);
    expect(fit.scale).toBeLessThan(1);
  });

  it('leaves an image in range untouched', () => {
    const png = solid(400, 300);
    const fit = fitImage(png);
    expect(fit.png).toBe(png);
    expect([fit.width, fit.height, fit.offsetX, fit.offsetY]).toEqual([400, 300, 0, 0]);
  });
});
