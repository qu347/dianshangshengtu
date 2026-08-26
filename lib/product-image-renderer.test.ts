import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import type { ImageRenderConfig } from "./image-render-config";
import { renderProductImage } from "./product-image-renderer";

const width = 1090;
const height = 1443;

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

describe("renderProductImage", () => {
  it("normalizes the native 3:4 image to PNG without changing its dimensions", async () => {
    const output = await renderProductImage(input, config());

    expect(await sharp(output).metadata()).toMatchObject({ width, height, format: "png" });
  });

  it("composites image-two dimension annotations into the output", async () => {
    const output = await renderProductImage(input, config({
      annotations: [{ label: "Height", displayValue: "4.72 in" }],
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

  it("escapes XML-sensitive annotation and watermark text instead of injecting SVG nodes", async () => {
    const injectedNode = "</text><script>";

    const output = await renderProductImage(input, config({
      annotations: [{
        label: `${injectedNode}&\"'`,
        displayValue: `${injectedNode}&\"'`,
      }],
      watermark: `${injectedNode}&\"'`,
      applyWatermark: true,
    }));

    expect(await sharp(output).metadata()).toMatchObject({ width, height, format: "png" });
  });
});
