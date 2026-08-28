import sharp from "sharp";
import { fetchPublicImage } from "./remote-image";

const MAX_INPUT_PIXELS = 4_000_000;
const BACKGROUND_BAND_RATIO = 0.08;
const REQUIRED_WHITE_RATIO = 0.995;
const NEAR_WHITE_MIN_CHANNEL = 225;
const NEAR_WHITE_MAX_SPREAD = 18;
const APPAREL_MIN_CHANNEL = 205;
const APPAREL_MAX_SPREAD = 12;
const APPAREL_BACKGROUND_DELTA = 6;
const APPAREL_ROUGH_STEP = 8;
const APPAREL_MAX_ROUGH_RATIO = 0.02;

export type WhiteBackgroundOptions = {
  mode?: "apparel";
};

function isNearWhite(
  data: Buffer,
  offset: number,
  minimumChannel: number,
  maximumSpread = NEAR_WHITE_MAX_SPREAD,
) {
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  return Math.min(red, green, blue) >= minimumChannel
    && Math.max(red, green, blue) - Math.min(red, green, blue) <= maximumSpread;
}

function maximumChannelDelta(data: Buffer, firstOffset: number, secondOffset: number) {
  return Math.max(
    Math.abs(data[firstOffset] - data[secondOffset]),
    Math.abs(data[firstOffset + 1] - data[secondOffset + 1]),
    Math.abs(data[firstOffset + 2] - data[secondOffset + 2]),
  );
}

function isInOuterBand(x: number, y: number, width: number, height: number) {
  const horizontalBand = Math.max(1, Math.round(width * BACKGROUND_BAND_RATIO));
  const verticalBand = Math.max(1, Math.round(height * BACKGROUND_BAND_RATIO));
  return x < horizontalBand
    || x >= width - horizontalBand
    || y < verticalBand
    || y >= height - verticalBand;
}

function hasSmoothApparelOuterBand(
  data: Buffer,
  width: number,
  height: number,
  channels: number,
) {
  let compared = 0;
  let rough = 0;
  const compare = (first: number, second: number) => {
    compared += 1;
    if (maximumChannelDelta(data, first * channels, second * channels) > APPAREL_ROUGH_STEP) {
      rough += 1;
    }
  };

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!isInOuterBand(x, y, width, height)) continue;
      const index = y * width + x;
      if (x + 1 < width && isInOuterBand(x + 1, y, width, height)) compare(index, index + 1);
      if (y + 1 < height && isInOuterBand(x, y + 1, width, height)) compare(index, index + width);
    }
  }
  return compared > 0 && rough / compared <= APPAREL_MAX_ROUGH_RATIO;
}

function isApparelBackgroundPixel(
  data: Buffer,
  width: number,
  channels: number,
  x: number,
  y: number,
) {
  const offset = (y * width + x) * channels;
  if (!isNearWhite(data, offset, APPAREL_MIN_CHANNEL, APPAREL_MAX_SPREAD)) return false;

  const leftOffset = y * width * channels;
  const rightOffset = (y * width + width - 1) * channels;
  if (
    !isNearWhite(data, leftOffset, APPAREL_MIN_CHANNEL, APPAREL_MAX_SPREAD)
    || !isNearWhite(data, rightOffset, APPAREL_MIN_CHANNEL, APPAREL_MAX_SPREAD)
  ) {
    return false;
  }

  const ratio = width > 1 ? x / (width - 1) : 0;
  for (let channel = 0; channel < 3; channel += 1) {
    const expected = data[leftOffset + channel]
      + (data[rightOffset + channel] - data[leftOffset + channel]) * ratio;
    if (Math.abs(data[offset + channel] - expected) > APPAREL_BACKGROUND_DELTA) return false;
  }
  return true;
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
  const apparelMode = options.mode === "apparel";
  const classificationData = apparelMode ? Buffer.from(data) : data;
  if (
    apparelMode
    && !hasSmoothApparelOuterBand(classificationData, info.width, info.height, info.channels)
  ) {
    throw new Error("白底背景处理失败");
  }
  const enqueue = (index: number) => {
    if (visited[index]) return;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    const isBackground = apparelMode
      ? isApparelBackgroundPixel(classificationData, info.width, info.channels, x, y)
      : isNearWhite(data, index * info.channels, NEAR_WHITE_MIN_CHANNEL);
    if (!isBackground) return;
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
