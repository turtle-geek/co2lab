// Downscales captured JPEG screenshots for trials (25/50/75 % scale), the same way the phone
// would have sent them: area-average resize, JPEG quality 70 (android SubtaskRunner uses 70).

import jpeg from "jpeg-js";

const QUALITY = 70;
const MIN_WIDTH = 160; // the phone never sends narrower screenshots

export function scaleJpeg(src: Buffer, scale: number): { data: Buffer; width: number; height: number } {
  const img = jpeg.decode(src, { useTArray: true, maxMemoryUsageInMB: 512 });
  if (scale >= 1) return { data: src, width: img.width, height: img.height };
  const w = Math.max(MIN_WIDTH, Math.round(img.width * scale));
  const h = Math.max(1, Math.round((img.height * w) / img.width));
  const out = new Uint8Array(w * h * 4);
  const fx = img.width / w;
  const fy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) {
          r += img.data[i]!;
          g += img.data[i + 1]!;
          b += img.data[i + 2]!;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  const enc = jpeg.encode({ data: out, width: w, height: h }, QUALITY);
  return { data: enc.data, width: w, height: h };
}
