// @vitest-environment node

import { createHmac } from "node:crypto";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signDownloadUrl } from "@/lib/download-token";
import type { ImageRenderConfig } from "@/lib/image-render-config";
import { GET } from "./route";

const secret = "test-secret";
const width = 1090;
const height = 1443;
const render: ImageRenderConfig = {
  imageIndex: 2,
  annotations: [{ label: "Height", displayValue: "4.72 in" }],
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
  process.env.DOWNLOAD_TOKEN_SECRET = secret;
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

function imageResponse() {
  return new Response(new Uint8Array(sourceImage), {
    status: 200,
    headers: { "Content-Type": "image/png" },
  });
}

function pendingResponse(
  onCancel: () => void,
  options: { status?: number; contentType?: string } = {},
) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel: onCancel,
  });
  const headers = options.contentType ? { "Content-Type": options.contentType } : undefined;
  return new Response(body, { status: options.status ?? 200, headers });
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
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await GET(requestFor(tampered));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects even correctly signed non-HTTPS source URLs before fetching", async () => {
    const token = signedTokenFor({
      kind: "download",
      url: "http://127.0.0.1/private-resource",
      render,
      exp: Math.floor(Date.now() / 1_000) + 60,
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await GET(requestFor(token));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirect responses while configuring fetch not to follow them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.example/result.png" },
      }),
    );

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://cdn.example/result.jpg",
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
    );
  });

  it("cancels a present upstream body before rejecting a non-2xx response", async () => {
    let cancelled = false;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      pendingResponse(() => { cancelled = true; }, { status: 500, contentType: "image/png" }),
    );

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(cancelled).toBe(true);
  });

  it("rejects a streamed response larger than 25 MiB and cancels its source", async () => {
    let cancelled = false;
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(25 * 1024 * 1024 + 1));
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(oversized, { headers: { "Content-Type": "image/png" } }),
    );

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(cancelled).toBe(true);
  });

  it("refuses non-image upstream responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not an image", { status: 200, headers: { "Content-Type": "text/html" } }),
    );

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "图片下载失败，请稍后重试" });
  });

  it("cancels present bodies before rejecting unsupported or missing content types", async () => {
    let cancelled = 0;
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(pendingResponse(
        () => { cancelled += 1; },
        { contentType: "image/x-unsupported" },
      ))
      .mockResolvedValueOnce(pendingResponse(() => { cancelled += 1; }));

    const unsupported = await GET(requestFor(downloadToken()));
    const missing = await GET(requestFor(downloadToken()));

    expect(unsupported.status).toBe(502);
    expect(missing.status).toBe(502);
    expect(cancelled).toBe(2);
  });

  it("refuses SVG input even though Sharp can decode it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(sourceImage), {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      }),
    );

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "图片下载失败，请稍后重试" });
  });

  it("returns a clear proxy failure instead of falling back to raw bytes when rendering fails", async () => {
    const rawBytes = new Uint8Array([1, 2, 3]);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(rawBytes, { status: 200, headers: { "Content-Type": "image/png" } }),
    );

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(502);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({ error: "图片下载失败，请稍后重试" });
  });

  it("renders identical PNG pixels for inline and attachment responses", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(imageResponse())
      .mockResolvedValueOnce(imageResponse());

    const attachment = await GET(requestFor(downloadToken()));
    const inline = await GET(requestFor(downloadToken(), true));
    const attachmentBytes = Buffer.from(await attachment.arrayBuffer());
    const inlineBytes = Buffer.from(await inline.arrayBuffer());

    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const response = await GET(requestFor(downloadToken()));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "图片下载服务尚未配置" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
