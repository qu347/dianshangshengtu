import sharp from "sharp";
import { fetchPublicImage } from "./remote-image";

const MAX_INPUT_PIXELS = 4_000_000;
const BACKGROUND_BAND_RATIO = 0.08;
const REQUIRED_WHITE_RATIO = 0.995;
const NEAR_WHITE_MIN_CHANNEL = 225;
const NEAR_WHITE_MAX_SPREAD = 18;

export type WhiteBackgroundOptions = {
  minimumChannel?: number;
};

function isNearWhite(data: Buffer, offset: number, minimumChannel: number) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return Math.min(red, green, blue) >= minimumChannel
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= NEAR_WHITE_MAX_SPREAD;
}

function pureWhiteOuterBandRatio(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  const horizontalBand = Math.max(1, Math.round(width * BACKGROUND_BAND_RATIO));
  const verticalBand = Math.max(1, Math.round(height * BACKGROUND_BAND_RATIO));
  let sampled = 0;
  let white = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (
        x >= horizontalBand
        && x < width - horizontalBand
        && y >= verticalBand
        && y < height - verticalBand
      ) {
        continue;
      }
      const offset = (y * width + x) * channels;
      sampled += 1;
      if (data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255) {
        white += 1;
      }
    }
  }
  return sampled > 0 ? white / sampled : 0;
}

export async function hasPureWhiteOuterBand(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height || info.channels < 3) return false;
  return pureWhiteOuterBandRatio(data, info.width, info.height, info.channels) >= REQUIRED_WHITE_RATIO;
}

export async function normalizeWhiteBackground(
  input: Buffer,
  options: WhiteBackgroundOptions = {},
) {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height || info.channels < 3) throw new Error("白底背景处理失败");

  const pixelCount = info.width * info.height;
  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  const minimumChannel = options.minimumChannel ?? NEAR_WHITE_MIN_CHANNEL;
  const enqueue = (index: number) => {
    if (visited[index] || !isNearWhite(data, index * info.channels, minimumChannel)) return;
    visited[index] = 1;
    queue[tail] = index;
    tail += 1;
  };

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x);
    enqueue((info.height - 1) * info.width + x);
  }
  for (let y = 1; y < info.height - 1; y += 1) {
    enqueue(y * info.width);
    enqueue(y * info.width + info.width - 1);
  }

  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    const offset = index * info.channels;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    if (x > 0) enqueue(index - 1);
    if (x + 1 < info.width) enqueue(index + 1);
    if (y > 0) enqueue(index - info.width);
    if (y + 1 < info.height) enqueue(index + info.width);
  }

  if (pureWhiteOuterBandRatio(data, info.width, info.height, info.channels) < REQUIRED_WHITE_RATIO) {
    throw new Error("白底背景处理失败");
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
    limitInputPixels: MAX_INPUT_PIXELS,
  }).png().toBuffer();
}

export async function isWhiteBackgroundImage(input: Buffer) {
  return hasPureWhiteOuterBand(input);
}

export async function validateGeneratedImage(
  url: string,
  imageIndex: number,
  fetchImage: (sourceUrl: string) => Promise<Buffer> = fetchPublicImage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (imageIndex !== 1) return { ok: true };
  let image: Buffer;
  try {
    image = await fetchImage(url);
  } catch {
    return { ok: false, error: "白底商品主图校验失败，请重试此图" };
  }
  try {
    await normalizeWhiteBackground(image);
    return { ok: true };
  } catch {
    return { ok: false, error: "白底商品主图不是纯白背景，请重试此图" };
  }
}

// Uploaded images are re-decoded server-side before any paid provider call:
// bytes that survive the magic-number check but cannot actually be decoded are
// rejected here, and decodable images are re-encoded to a bounded webp so the
// provider payload and base64 memory footprint stay small.
export async function normalizeUploadedImage(input: Buffer) {
  try {
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
  } catch {
    throw new Error("图片格式或大小不符合要求");
  }
}
