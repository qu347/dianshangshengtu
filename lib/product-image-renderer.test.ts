import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { ImageRenderConfig } from "./image-render-config";
import { renderProductImage } from "./product-image-renderer";

const width = 1090;
const height = 1443;
const maxCjkText = "超长中文尺寸标注需要自动换行保持清晰可读".repeat(2).slice(0, 40);
const maxEnglishText = "Maximum product dimension must remain readable".slice(0, 40);
const maxCyrillicText = "Максимальный размер товара должен читаться".slice(0, 40);
const maxWideCyrillicText = "Ж".repeat(40);

let input: Buffer;

beforeAll(async () => {
  input = await sharp({
    create: { width, height, channels: 3, background: "#eeeeee" },
  }).png().toBuffer();
});

function config(overrides: Partial<ImageRenderConfig> = {}): ImageRenderConfig {
  return {
    imageIndex: 2,
    annotations: [],
    watermark: "",
    applyWatermark: false,
    ...overrides,
  };
}

async function rawRegion(
  image: Buffer,
  region: { left: number; top: number; width: number; height: number },
) {
  return sharp(image).extract(region).removeAlpha().raw().toBuffer();
}

function minimumChannelValue(pixels: Buffer) {
  let minimum = 255;
  for (const value of pixels) minimum = Math.min(minimum, value);
  return minimum;
}

describe("renderProductImage", () => {
  it("normalizes the native 3:4 image to PNG without changing its dimensions", async () => {
    const output = await renderProductImage(input, config());

    expect(await sharp(output).metadata()).toMatchObject({ width, height, format: "png" });
  });

  it("rejects compressed images whose decoded pixels exceed the renderer budget", async () => {
    const amplified = await sharp({
      create: { width: 2500, height: 2000, channels: 3, background: "#eeeeee" },
    }).png().toBuffer();

    await expect(renderProductImage(amplified, config())).rejects.toThrow();
  });

  it("refuses to render a non-white image-one result", async () => {
    const wood = await sharp({
      create: { width, height, channels: 3, background: "#a07850" },
    }).png().toBuffer();

    await expect(renderProductImage(wood, config({ imageIndex: 1 })))
      .rejects.toThrow("白底商品主图不是纯白背景");
  });

  it.each([1, 2])("normalizes an off-white background for fixed image %s", async (imageIndex) => {
    const source = await sharp({
      create: { width, height, channels: 3, background: "#eeeeee" },
    }).composite([{
      input: await sharp({
        create: { width: 300, height: 500, channels: 3, background: "#777777" },
      }).png().toBuffer(),
      left: 395,
      top: 450,
    }]).png().toBuffer();

    const output = await renderProductImage(source, config({ imageIndex }));

    expect(Array.from(await rawRegion(output, { left: 10, top: 10, width: 1, height: 1 })))
      .toEqual([255, 255, 255]);
    expect(Array.from(await rawRegion(output, { left: 500, top: 600, width: 1, height: 1 })))
      .toEqual([119, 119, 119]);
  });

  it("rejects an overlong oriented dimension before composition", async () => {
    const overlong = await sharp({
      create: { width: 4097, height: 1, channels: 3, background: "#eeeeee" },
    }).png().toBuffer();

    await expect(renderProductImage(overlong, config({
      annotations: [{ id: "height", label: "Height", displayValue: "4.72 in" }],
    }))).rejects.toThrow("图片尺寸超过限制");
  });

  it("composites image-two dimension annotations into the output", async () => {
    const output = await renderProductImage(input, config({
      annotations: [{ id: "height", label: "Height", displayValue: "4.72 in" }],
    }));

    expect(output.equals(input)).toBe(false);
    expect(await sharp(output).metadata()).toMatchObject({ width, height, format: "png" });
  });

  it("composites an enabled watermark into the output", async () => {
    const output = await renderProductImage(input, config({
      watermark: "Brand",
      applyWatermark: true,
    }));

    expect(output.equals(input)).toBe(false);
    expect(await sharp(output).metadata()).toMatchObject({ width, height, format: "png" });
  });

  it("fits max-length CJK and English annotations inside the right-side padding", async () => {
    expect(maxCjkText).toHaveLength(40);
    expect(maxEnglishText).toHaveLength(40);
    const output = await renderProductImage(input, config({
      annotations: [{ id: "size", label: maxCjkText, displayValue: maxEnglishText }],
    }));

    const edge = await rawRegion(output, { left: width - 12, top: 0, width: 12, height });
    const annotationArea = await rawRegion(output, {
      left: Math.round(width * 0.7),
      top: 0,
      width: Math.round(width * 0.25),
      height,
    });

    expect(minimumChannelValue(edge)).toBeGreaterThan(230);
    expect(minimumChannelValue(annotationArea)).toBeLessThan(100);
  });

  it("wraps a max-length Cyrillic watermark inside the bottom-right safe area", async () => {
    expect(maxCyrillicText).toHaveLength(40);
    const output = await renderProductImage(input, config({
      watermark: maxCyrillicText,
      applyWatermark: true,
    }));
    const baseline = await renderProductImage(input, config());
    const untouchedRegion = { left: 0, top: height - 180, width: 400, height: 180 };
    const watermarkRegion = { left: width - 600, top: height - 180, width: 600, height: 180 };

    expect((await rawRegion(output, untouchedRegion)).equals(
      await rawRegion(baseline, untouchedRegion),
    )).toBe(true);
    expect((await rawRegion(output, watermarkRegion)).equals(
      await rawRegion(input, watermarkRegion),
    )).toBe(false);
  });

  it("fits max-length wide uppercase Cyrillic annotations inside the right-side padding", async () => {
    expect(maxWideCyrillicText).toHaveLength(40);
    const output = await renderProductImage(input, config({
      annotations: [{ id: "size", label: maxWideCyrillicText, displayValue: maxWideCyrillicText }],
    }));
    const edge = await rawRegion(output, { left: width - 12, top: 0, width: 12, height });
    const annotationArea = await rawRegion(output, {
      left: Math.round(width * 0.7),
      top: 0,
      width: Math.round(width * 0.25),
      height,
    });

    expect(minimumChannelValue(edge)).toBeGreaterThan(230);
    expect(minimumChannelValue(annotationArea)).toBeLessThan(100);
  });

  it("fits a max-length wide uppercase Cyrillic watermark inside its safe area", async () => {
    expect(maxWideCyrillicText).toHaveLength(40);
    const output = await renderProductImage(input, config({
      watermark: maxWideCyrillicText,
      applyWatermark: true,
    }));
    const baseline = await renderProductImage(input, config());
    const untouchedRegion = { left: 0, top: height - 180, width: 400, height: 180 };
    const watermarkRegion = { left: width - 600, top: height - 180, width: 600, height: 180 };

    expect((await rawRegion(output, untouchedRegion)).equals(
      await rawRegion(baseline, untouchedRegion),
    )).toBe(true);
    expect((await rawRegion(output, watermarkRegion)).equals(
      await rawRegion(input, watermarkRegion),
    )).toBe(false);
  });

  it("escapes XML-sensitive annotation and watermark text instead of injecting SVG nodes", async () => {
    const injectedNode = "</text><script>";

    const output = await renderProductImage(input, config({
      annotations: [{
        id: "injected",
        label: `${injectedNode}&\"'`,
        displayValue: `${injectedNode}&\"'`,
      }],
      watermark: `${injectedNode}&\"'`,
      applyWatermark: true,
    }));

    expect(await sharp(output).metadata()).toMatchObject({ width, height, format: "png" });
  });
});
