import sharp from "sharp";
import { beforeAll, expect, it, vi } from "vitest";
import type { ImageRenderConfig } from "./image-render-config";
import { prepareGeneratedImageResult } from "./product-image-result";

const annotation = { id: "height", label: "高度", displayValue: "5 cm" };
const smartLayout = {
  bounds: { left: 260, top: 220, right: 740, bottom: 820 },
  placements: [{ id: "height", axis: "vertical" as const, side: "right" as const }],
};
let offWhite: Buffer;
let wood: Buffer;

beforeAll(async () => {
  offWhite = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#eeeeee" },
  }).composite([{
    input: await sharp({
      create: { width: 120, height: 220, channels: 3, background: "#777777" },
    }).png().toBuffer(),
    left: 90,
    top: 90,
  }]).png().toBuffer();
  wood = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#a07850" },
  }).png().toBuffer();
});

function render(imageIndex: number): ImageRenderConfig {
  return {
    imageIndex,
    annotations: imageIndex === 2 ? [annotation] : [],
    ...(imageIndex === 2 ? {
      dimensionLayout: {
        bounds: { left: 220, top: 250, right: 780, bottom: 780 },
        placements: [{ id: "height", axis: "horizontal", side: "top" }],
      },
    } : {}),
    watermark: "",
    applyWatermark: false,
  };
}

it("accepts a safely normalizable image-one result without analyzing placement", async () => {
  const fetchImage = vi.fn().mockResolvedValue(offWhite);
  const analyzeLayout = vi.fn();

  await expect(prepareGeneratedImageResult({
    url: "https://cdn.example/main.png",
    render: render(1),
    fetchImage,
    analyzeLayout,
  })).resolves.toEqual({ ok: true, render: render(1) });
  expect(analyzeLayout).not.toHaveBeenCalled();
});

it("returns a retryable main-image error for a non-white background", async () => {
  await expect(prepareGeneratedImageResult({
    url: "https://cdn.example/main.png",
    render: render(1),
    fetchImage: vi.fn().mockResolvedValue(wood),
  })).resolves.toEqual({
    ok: false,
    error: "白底商品主图背景处理失败，请重试此图",
  });
});

it("analyzes a normalized image-two PNG and returns the trusted smart layout", async () => {
  const analyzeLayout = vi.fn().mockResolvedValue(smartLayout);

  await expect(prepareGeneratedImageResult({
    url: "https://cdn.example/dimensions.png",
    render: render(2),
    fetchImage: vi.fn().mockResolvedValue(offWhite),
    analyzeLayout,
  })).resolves.toEqual({
    ok: true,
    render: { ...render(2), dimensionLayout: smartLayout },
  });
  expect(analyzeLayout).toHaveBeenCalledWith({
    image: expect.stringMatching(/^data:image\/png;base64,/),
    annotations: [annotation],
  });
});

it("skips fixed-image preparation for image three and later", async () => {
  const fetchImage = vi.fn();
  const analyzeLayout = vi.fn();

  await expect(prepareGeneratedImageResult({
    url: "https://cdn.example/lifestyle.png",
    render: render(3),
    fetchImage,
    analyzeLayout,
  })).resolves.toEqual({ ok: true, render: render(3) });
  expect(fetchImage).not.toHaveBeenCalled();
  expect(analyzeLayout).not.toHaveBeenCalled();
});
