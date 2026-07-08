/*
 * Image processing — the only module that touches `sharp`.
 *
 * Two jobs:
 *   1. downsampleToJpeg: normalize an uploaded specimen image to a ≤20 MP
 *      JPEG. This becomes the canonical "original" IRIS stores (we keep only
 *      this, per the product decision — the raw upload is not retained).
 *   2. base64ToJpeg: turn the base64 images VoucherVisionGO returns
 *      (full-size + cropped collage) into JPEG bytes on disk.
 *
 * sharp is a native module. It ships prebuilt binaries (works under both
 * Electron and plain Node), and electron-builder's install-app-deps rebuilds
 * it for the packaged runtime. Keep all sharp calls behind this file so the
 * rest of the server never imports it directly.
 */

const sharp = require('sharp');

const MAX_MP = 20;                 // megapixels
const MAX_PIXELS = MAX_MP * 1_000_000;
const JPEG_QUALITY = 85;

/*
 * Downsample + transcode an image buffer to a ≤20 MP JPEG.
 *   - EXIF orientation is baked in (rotate()) so the stored pixels are upright.
 *   - Only scales DOWN; images already under the cap are re-encoded as JPEG
 *     at the same size (so PNG/TIFF/HEIC uploads still become JPEG).
 * Returns { buffer, width, height }. Throws if the bytes can't be decoded —
 * callers decide whether to fall back to storing the original bytes.
 */
async function downsampleToJpeg(buffer, { maxPixels = MAX_PIXELS, quality = JPEG_QUALITY } = {}) {
  const pipeline = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await pipeline.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

  if (w > 0 && h > 0 && w * h > maxPixels) {
    const scale = Math.sqrt(maxPixels / (w * h));
    const targetW = Math.max(1, Math.floor(w * scale));
    pipeline.resize({ width: targetW, withoutEnlargement: true });
  }

  const out = await pipeline.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/*
 * Decode a base64 image string and re-encode as a JPEG buffer. VVGO already
 * returns JPEG (`collage_image_format: "jpeg"`), but round-tripping through
 * sharp guarantees a valid, orientation-correct JPG regardless of what the
 * server sent. Returns null for empty/invalid input so the caller can skip.
 */
async function base64ToJpeg(b64, { quality = JPEG_QUALITY } = {}) {
  if (!b64 || typeof b64 !== 'string') return null;
  const raw = Buffer.from(b64, 'base64');
  if (raw.length === 0) return null;
  const out = await sharp(raw, { failOn: 'none' })
    .jpeg({ quality })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, width: out.info.width, height: out.info.height };
}

/*
 * Assert that a buffer is a decodable raster image. Throws otherwise — used to
 * reject non-images before they're stored (e.g. an HTML "Request Rejected" page
 * a bot-blocking host returned instead of the actual image). sharp.metadata()
 * throws on an unrecognized format; we also require real pixel dimensions.
 */
async function assertImage(buffer) {
  const meta = await sharp(buffer).metadata();
  if (!meta || !meta.format || !meta.width || !meta.height) {
    throw new Error('Not a decodable image.');
  }
  return meta;
}

module.exports = { downsampleToJpeg, base64ToJpeg, assertImage, MAX_MP };
