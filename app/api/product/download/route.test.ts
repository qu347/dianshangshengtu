// @vitest-environment node

import { createHmac } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signDownloadUrl } from "@/lib/download-token";
import type { ImageRenderConfig } from "@/lib/image-render-config";
import { fetchPublicImage } from "@/lib/remote-image";
import { GET } from "./route";

vi.mock("@/lib/remote-image", () => ({ fetchPublicImage: vi.fn() }));

const secret = "test-secret";
const width = 1090;
const height = 1443;
const render: ImageRenderConfig = {
  imageIndex: 2,
  annotations: [{ id: "height", label: "Height", displayValue: "4.72 in" }],
  dimensionLayout: {
    bounds: { left: 180, top: 220, right: 820, bottom: 820 },
    placements: [{ id: "height", axis: "vertical", side: "right" }],
  },
  watermark: "Brand",
  applyWatermark: true,
};

let sourceImage: Buffer;

beforeAll(async () => {
  sourceImage = await sharp({
    create: { width, height, channels: 3, background: "#eeeeee" },
  }).png().toBuffer();
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = secret;
  vi.mocked(fetchPublicImage).mockResolvedValue(sourceImage as Buffer<ArrayBuffer>);
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});

function downloadToken() {
  return signDownloadUrl("https://cdn.example/result.jpg", render, secret);
}

function requestFor(token: string, inline = false) {
  const url = new URL("http://localhost/api/product/download");
  url.searchParams.set("token", token);
  if (inline) url.searchParams.set("inline", "1");
  return new Request(url);
}

function signedTokenFor(payload: unknown) {
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payloadPart).digest("base64url");
  return `${payloadPart}.${signature}`;
}

describe("signed download proxy", () => {
  it("rejects a tampered token without fetching an upstream URL", async () => {
    const token = downloadToken();
    const changedLastCharacter = token.endsWith("A") ? "B" : "A";
    const tampered = `${token.slice(0, -1)}${changedLastCharacter}`;
    const response = await GET(requestFor(tampered));

    expect(response.status).toBe(400);
    expect(fetchPublicImage).not.toHaveBeenCalled();
  });

  it("rejects a signed legacy payload without fetching an upstream URL", async () => {
    const token = signedTokenFor({
      url: "https://cdn.example/result.jpg",
      exp: Math.floor(Date.now() / 1_000) + 60,
    });
    const response = await GET(requestFor(token));

    expect(response.status).toBe(400);
    expect(fetchPublicImage).not.toHaveBeenCalled();
  });

  it("rejects even correctly signed non-HTTPS source URLs before fetching", async () => {
    const token = signedTokenFor({
      kind: "download",
      url: "http://127.0.0.1/private-resource",
      render,
      exp: Math.floor(Date.now() / 1_000) + 60,
    });
    const response = await GET(requestFor(token));

    expect(response.status).toBe(400);
    expect(fetchPublicImage).not.toHaveBeenCalled();
  });

  it("fetches the signed source only through the public-address-pinned image boundary", async () => {
    const ordinaryFetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("ordinary fetch must not be used"),
    );

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(200);
    expect(fetchPublicImage).toHaveBeenCalledWith("https://cdn.example/result.jpg");
    expect(ordinaryFetch).not.toHaveBeenCalled();
  });

  it("maps a secure image fetch failure to a private no-store proxy error", async () => {
    vi.mocked(fetchPublicImage).mockRejectedValue(new Error("图片响应过大"));

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "图片下载失败，请稍后重试" });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("refuses SVG input even though Sharp can decode it", async () => {
    vi.mocked(fetchPublicImage).mockRejectedValue(new Error("图片下载失败，请稍后重试"));

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "图片下载失败，请稍后重试" });
  });

  it("refuses actual SVG bytes mislabeled as an allowed raster MIME", async () => {
    const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#eeeeee" />
    </svg>`);
    vi.mocked(fetchPublicImage).mockResolvedValue(svg);

    const response = await GET(requestFor(downloadToken()));
    const responseBytes = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(JSON.parse(responseBytes.toString())).toEqual({ error: "图片下载失败，请稍后重试" });
    expect(responseBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
      .toBe(false);
  });

  it("returns a clear proxy failure instead of falling back to raw bytes when rendering fails", async () => {
    const rawBytes = new Uint8Array([1, 2, 3]);
    vi.mocked(fetchPublicImage).mockResolvedValue(Buffer.from(rawBytes));

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "图片下载失败，请稍后重试" });
  });

  it("renders identical PNG pixels for inline and attachment responses", async () => {
    const attachment = await GET(requestFor(downloadToken()));
    const inline = await GET(requestFor(downloadToken(), true));
    const attachmentBytes = Buffer.from(await attachment.arrayBuffer());
    const inlineBytes = Buffer.from(await inline.arrayBuffer());

    expect(fetchPublicImage).toHaveBeenCalledTimes(2);
    expect(attachment.status).toBe(200);
    expect(inline.status).toBe(200);
    expect(attachment.headers.get("Content-Disposition"))
      .toBe("attachment; filename=\"result.png\"");
    expect(inline.headers.get("Content-Disposition")).toBe("inline; filename=\"result.png\"");
    expect(attachment.headers.get("Content-Type")).toBe("image/png");
    expect(attachment.headers.get("Cache-Control")).toBe("private, no-store");
    expect(attachment.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(inlineBytes.equals(attachmentBytes)).toBe(true);
    expect(attachmentBytes.equals(sourceImage)).toBe(false);
    expect(await sharp(attachmentBytes).metadata()).toMatchObject({ width, height, format: "png" });
  });

  it("returns 503 before token verification when the signing secret is absent", async () => {
    delete process.env.DOWNLOAD_TOKEN_SECRET;
    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "图片下载服务尚未配置" });
    expect(fetchPublicImage).not.toHaveBeenCalled();
  });
});
