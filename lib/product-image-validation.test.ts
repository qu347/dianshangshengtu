// @vitest-environment node

import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  hasPureWhiteOuterBand,
  isWhiteBackgroundImage,
  normalizeWhiteBackground,
  validateGeneratedImage,
} from "./product-image-validation";

let compliant: Buffer;
let noncompliant: Buffer;
let safelyNormalizable: Buffer;

beforeAll(async () => {
  compliant = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#ffffff" },
  }).composite([{
    input: await sharp({
      create: { width: 120, height: 220, channels: 3, background: "#335577" },
    }).png().toBuffer(),
    left: 90,
    top: 90,
  }]).png().toBuffer();
  noncompliant = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#a07850" },
  }).png().toBuffer();
  safelyNormalizable = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#eeeeee" },
  }).composite([{
    input: await sharp({
      create: { width: 120, height: 220, channels: 3, background: "#a0a0a0" },
    }).composite([{
      input: await sharp({
        create: { width: 20, height: 20, channels: 3, background: "#f0f0f0" },
      }).png().toBuffer(),
      left: 50,
      top: 90,
    }]).png().toBuffer(),
    left: 90,
    top: 90,
  }]).png().toBuffer();
});

async function pixelAt(image: Buffer, left: number, top: number) {
  const { data } = await sharp(image)
    .extract({ left, top, width: 1, height: 1 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Array.from(data.subarray(0, 3));
}

describe("white-background validation", () => {
  it("accepts a centered product surrounded by pure white background pixels", async () => {
    await expect(isWhiteBackgroundImage(compliant)).resolves.toBe(true);
  });

  it("rejects a generated image whose background is not white", async () => {
    await expect(isWhiteBackgroundImage(noncompliant)).resolves.toBe(false);
  });

  it("turns only border-connected neutral near-white pixels into exact white", async () => {
    const normalized = await normalizeWhiteBackground(safelyNormalizable);

    await expect(hasPureWhiteOuterBand(normalized)).resolves.toBe(true);
    await expect(pixelAt(normalized, 10, 10)).resolves.toEqual([255, 255, 255]);
    await expect(pixelAt(normalized, 100, 110)).resolves.toEqual([160, 160, 160]);
    await expect(pixelAt(normalized, 150, 190)).resolves.toEqual([240, 240, 240]);
  });

  it("rejects a non-white textured-color background instead of erasing it", async () => {
    const wood = await sharp({
      create: { width: 300, height: 400, channels: 3, background: "#a07850" },
    }).png().toBuffer();

    await expect(normalizeWhiteBackground(wood)).rejects.toThrow("白底背景处理失败");
  });

  it("accepts a main image whose off-white background can be safely normalized", async () => {
    const fetchImage = vi.fn().mockResolvedValue(safelyNormalizable);

    await expect(validateGeneratedImage(
      "https://cdn.example/result.png",
      1,
      fetchImage,
    )).resolves.toEqual({ ok: true });
  });

  it("returns a retryable validation result and never exposes a noncompliant image", async () => {
    const fetchImage = vi.fn().mockResolvedValue(noncompliant);

    await expect(validateGeneratedImage(
      "https://cdn.example/result.png",
      1,
      fetchImage,
    )).resolves.toEqual({
      ok: false,
      error: "白底商品主图不是纯白背景，请重试此图",
    });
    expect(fetchImage).toHaveBeenCalledOnce();
  });

  it("does not fetch non-main images for white-background validation", async () => {
    const fetchImage = vi.fn();

    await expect(validateGeneratedImage(
      "https://cdn.example/result.png",
      2,
      fetchImage,
    )).resolves.toEqual({ ok: true });
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
