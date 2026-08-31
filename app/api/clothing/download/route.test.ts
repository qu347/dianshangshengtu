// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signDownloadUrl } from "@/lib/download-token";
import type { ImageRenderConfig } from "@/lib/image-render-config";
import { renderProductImage } from "@/lib/product-image-renderer";
import { fetchPublicImage } from "@/lib/remote-image";
import { GET } from "./route";

vi.mock("@/lib/product-image-renderer", () => ({ renderProductImage: vi.fn() }));
vi.mock("@/lib/remote-image", () => ({ fetchPublicImage: vi.fn() }));

const render: ImageRenderConfig = {
  imageIndex: 1,
  annotations: [],
  watermark: "",
  applyWatermark: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
  vi.mocked(fetchPublicImage).mockResolvedValue(Buffer.from("source"));
  vi.mocked(renderProductImage).mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});
afterEach(() => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});
it("verifies, safely fetches, and renders the same PNG pipeline as product downloads", async () => {
  const token = signDownloadUrl("https://cdn.example/result.webp", render, "test-secret");
  const response = await GET(new Request(
    `http://localhost/api/clothing/download?inline=1&token=${encodeURIComponent(token)}`,
  ));
  expect(response.status).toBe(200);
  expect(fetchPublicImage).toHaveBeenCalledWith("https://cdn.example/result.webp");
  expect(renderProductImage).toHaveBeenCalledWith(Buffer.from("source"), render);
  expect(Buffer.from(await response.arrayBuffer())).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("rejects a tampered token without fetching an upstream URL", async () => {
  const response = await GET(new Request("http://localhost/api/clothing/download?token=tampered"));
  expect(response.status).toBe(400);
  expect(fetchPublicImage).not.toHaveBeenCalled();
});
