// @vitest-environment node

import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  hasPureWhiteOuterBand,
  isWhiteBackgroundImage,
  normalizeUploadedImage,
  normalizeWhiteBackground,
  validateGeneratedImage,
} from "./product-image-validation";

let compliant: Buffer;
let noncompliant: Buffer;
let safelyNormalizable: Buffer;
let lightNeutralGradient: Buffer;
let lightGarment: Buffer;
let paleColoredBackground: Buffer;
let neutralTexture: Buffer;

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
  lightNeutralGradient = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#d8d8d8" />
          <stop offset="1" stop-color="#f5f5f5" />
        </linearGradient>
      </defs>
      <rect width="300" height="400" fill="url(#background)" />
      <rect x="90" y="90" width="120" height="220" fill="#505050" />
    </svg>
  `)).png().toBuffer();
  lightGarment = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#d8d8d8" },
  }).composite([{
    input: await sharp({
      create: { width: 120, height: 220, channels: 3, background: "#d0d0d0" },
    }).png().toBuffer(),
    left: 90,
    top: 90,
  }]).png().toBuffer();
  paleColoredBackground = await sharp({
    create: { width: 300, height: 400, channels: 3, background: "#d4e6d4" },
  }).png().toBuffer();
  neutralTexture = await sharp(Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="300" height="400">
      <defs>
        <pattern id="checker" width="16" height="16" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#d8d8d8" />
          <rect x="8" width="8" height="8" fill="#f0f0f0" />
          <rect y="8" width="8" height="8" fill="#f0f0f0" />
          <rect x="8" y="8" width="8" height="8" fill="#d8d8d8" />
        </pattern>
      </defs>
      <rect width="300" height="400" fill="url(#checker)" />
    </svg>
  `)).png().toBuffer();
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

  it("normalizes a light neutral gradient only when apparel tolerance is requested", async () => {
    await expect(normalizeWhiteBackground(lightNeutralGradient)).rejects.toThrow("白底背景处理失败");

    const normalized = await normalizeWhiteBackground(lightNeutralGradient, { mode: "apparel" });

    await expect(hasPureWhiteOuterBand(normalized)).resolves.toBe(true);
    await expect(pixelAt(normalized, 10, 10)).resolves.toEqual([255, 255, 255]);
    await expect(pixelAt(normalized, 150, 190)).resolves.toEqual([80, 80, 80]);
  });

  it("keeps a light neutral garment distinct from an apparel background", async () => {
    const normalized = await normalizeWhiteBackground(lightGarment, { mode: "apparel" });

    await expect(pixelAt(normalized, 10, 10)).resolves.toEqual([255, 255, 255]);
    await expect(pixelAt(normalized, 150, 190)).resolves.toEqual([208, 208, 208]);
  });

  it.each([
    ["pale colored", () => paleColoredBackground],
    ["neutral textured", () => neutralTexture],
  ])("rejects a %s apparel background", async (_label, source) => {
    await expect(normalizeWhiteBackground(source(), { mode: "apparel" }))
      .rejects.toThrow("白底背景处理失败");
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

describe("normalizeUploadedImage", () => {
  it("re-encodes a decodable upload to webp", async () => {
    const png = await sharp({
      create: { width: 40, height: 40, channels: 3, background: "#eeeeee" },
    }).png().toBuffer();

    const normalized = await normalizeUploadedImage(png);

    await expect(sharp(normalized).metadata()).resolves.toMatchObject({ format: "webp" });
  });

  it("downscales an upload whose long edge exceeds 2048", async () => {
    const oversized = await sharp({
      create: { width: 2500, height: 1200, channels: 3, background: "#eeeeee" },
    }).png().toBuffer();

    const normalized = await normalizeUploadedImage(oversized);

    await expect(sharp(normalized).metadata()).resolves.toMatchObject({ width: 2048, height: 983 });
  });

  it("rejects bytes that survive the magic-number check but cannot decode", async () => {
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("this is not really a png"),
    ]);

    await expect(normalizeUploadedImage(fake)).rejects.toThrow("图片格式或大小不符合要求");
  });
});
