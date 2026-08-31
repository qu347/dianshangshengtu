// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { signClipUrl, signKeyframeUrl } from "@/lib/download-token";
import { fetchPublicImage, fetchPublicVideo } from "@/lib/remote-image";
import { normalizeUploadedImage } from "@/lib/product-image-validation";
import { GET } from "./route";

vi.mock("@/lib/remote-image", () => ({ fetchPublicImage: vi.fn(), fetchPublicVideo: vi.fn() }));
vi.mock("@/lib/product-image-validation", () => ({ normalizeUploadedImage: vi.fn() }));

const secret = "test-secret";
const mp4 = Buffer.from("video-bytes");
const png = Buffer.from("png-bytes");
const webp = Buffer.from("webp-bytes");

function requestFor(token: string, inline = false) {
  const url = new URL("http://localhost/api/product-video/download");
  url.searchParams.set("token", token);
  if (inline) url.searchParams.set("inline", "1");
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = secret;
  vi.mocked(fetchPublicVideo).mockResolvedValue(mp4);
  vi.mocked(fetchPublicImage).mockResolvedValue(png);
  vi.mocked(normalizeUploadedImage).mockResolvedValue(webp);
});

it("returns 503 without the signing secret", async () => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;
  expect((await GET(requestFor("t"))).status).toBe(503);
});

it("rejects a missing or tampered token", async () => {
  expect((await GET(new Request("http://localhost/api/product-video/download"))).status).toBe(400);

  const token = signClipUrl("https://cdn.example/clip.mp4", secret);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  expect((await GET(requestFor(tampered))).status).toBe(400);
  expect(fetchPublicVideo).not.toHaveBeenCalled();
});

it("rejects an expired token", async () => {
  const expired = signClipUrl("https://cdn.example/clip.mp4", secret, Math.floor(Date.now() / 1000) - 3700);
  expect((await GET(requestFor(expired))).status).toBe(400);
  expect(fetchPublicVideo).not.toHaveBeenCalled();
});

it("proxies the clip as an mp4 attachment with private no-store headers", async () => {
  const token = signClipUrl("https://cdn.example/clip.mp4", secret);
  const response = await GET(requestFor(token));

  expect(fetchPublicVideo).toHaveBeenCalledWith("https://cdn.example/clip.mp4");
  expect(fetchPublicImage).not.toHaveBeenCalled();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("video/mp4");
  expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=\"product-video.mp4\"");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(mp4);
});

it("proxies a keyframe through the bounded image path as normalized webp", async () => {
  const token = signKeyframeUrl("https://cdn.example/keyframe.png", secret);
  const response = await GET(requestFor(token, true));

  expect(fetchPublicImage).toHaveBeenCalledWith("https://cdn.example/keyframe.png");
  expect(fetchPublicVideo).not.toHaveBeenCalled();
  expect(normalizeUploadedImage).toHaveBeenCalledWith(png);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("Content-Disposition")).toBe("inline; filename=\"product-video-keyframe.webp\"");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(webp);
});

it("marks inline requests and maps fetch failures to a proxy error", async () => {
  const inline = await GET(requestFor(signClipUrl("https://cdn.example/clip.mp4", secret), true));
  expect(inline.headers.get("Content-Disposition")).toContain("inline");

  vi.mocked(fetchPublicVideo).mockRejectedValueOnce(new Error("视频响应过大"));
  const failed = await GET(requestFor(signClipUrl("https://cdn.example/clip.mp4", secret)));
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "视频下载失败，请稍后重试" });
});
