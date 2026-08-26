// @vitest-environment node

import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { isWhiteBackgroundImage, validateGeneratedImage } from "./product-image-validation";

let compliant: Buffer;
let noncompliant: Buffer;

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
    create: { width: 300, height: 400, channels: 3, background: "#eeeeee" },
  }).png().toBuffer();
});

describe("white-background validation", () => {
  it("accepts a centered product surrounded by pure white background pixels", async () => {
    await expect(isWhiteBackgroundImage(compliant)).resolves.toBe(true);
  });

  it("rejects a generated image whose background is not white", async () => {
    await expect(isWhiteBackgroundImage(noncompliant)).resolves.toBe(false);
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
