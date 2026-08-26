import sharp from "sharp";
import { fetchPublicImage } from "./remote-image";

const MAX_INPUT_PIXELS = 4_000_000;
const BACKGROUND_BAND_RATIO = 0.08;
const REQUIRED_WHITE_RATIO = 0.995;

export async function isWhiteBackgroundImage(input: Buffer) {
  const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (!info.width || !info.height || info.channels < 3) return false;

  const horizontalBand = Math.max(1, Math.round(info.width * BACKGROUND_BAND_RATIO));
  const verticalBand = Math.max(1, Math.round(info.height * BACKGROUND_BAND_RATIO));
  let sampled = 0;
  let white = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (
        x >= horizontalBand
        && x < info.width - horizontalBand
        && y >= verticalBand
        && y < info.height - verticalBand
      ) {
        continue;
      }
      const offset = (y * info.width + x) * info.channels;
      sampled += 1;
      if (data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255) {
        white += 1;
      }
    }
  }
  return sampled > 0 && white / sampled >= REQUIRED_WHITE_RATIO;
}

export async function validateGeneratedImage(
  url: string,
  imageIndex: number,
  fetchImage: (sourceUrl: string) => Promise<Buffer> = fetchPublicImage,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (imageIndex !== 1) return { ok: true };
  try {
    const image = await fetchImage(url);
    if (await isWhiteBackgroundImage(image)) return { ok: true };
    return { ok: false, error: "白底商品主图不是纯白背景，请重试此图" };
  } catch {
    return { ok: false, error: "白底商品主图校验失败，请重试此图" };
  }
}
