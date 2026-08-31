// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { signClipUrl } from "@/lib/download-token";
import { fetchPublicVideo } from "@/lib/remote-image";
import { GET } from "./route";

vi.mock("@/lib/remote-image", () => ({ fetchPublicVideo: vi.fn() }));

const secret = "test-secret";
const mp4 = Buffer.from("video-bytes");

function requestFor(token: string, inline = false) {
  const url = new URL("http://localhost/api/video-remake/download");
  url.searchParams.set("token", token);
  if (inline) url.searchParams.set("inline", "1");
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = secret;
  vi.mocked(fetchPublicVideo).mockResolvedValue(mp4);
});

it("returns 503 without the signing secret", async () => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;
  expect((await GET(requestFor("t"))).status).toBe(503);
});

it("rejects a missing or tampered token", async () => {
  expect((await GET(new Request("http://localhost/api/video-remake/download"))).status).toBe(400);

  const token = signClipUrl("https://cdn.example/clip.mp4", secret);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  expect((await GET(requestFor(tampered))).status).toBe(400);
  expect(fetchPublicVideo).not.toHaveBeenCalled();
});

it("proxies the clip as an mp4 attachment with private no-store headers", async () => {
  const token = signClipUrl("https://cdn.example/clip.mp4", secret);
  const response = await GET(requestFor(token));

  expect(fetchPublicVideo).toHaveBeenCalledWith("https://cdn.example/clip.mp4");
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("video/mp4");
  expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=\"video-clip.mp4\"");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(mp4);
});

it("marks inline requests and maps fetch failures to a proxy error", async () => {
  const inline = await GET(requestFor(signClipUrl("https://cdn.example/clip.mp4", secret), true));
  expect(inline.headers.get("Content-Disposition")).toContain("inline");

  vi.mocked(fetchPublicVideo).mockRejectedValueOnce(new Error("视频响应过大"));
  const failed = await GET(requestFor(signClipUrl("https://cdn.example/clip.mp4", secret)));
  expect(failed.status).toBe(502);
  expect(await failed.json()).toEqual({ error: "视频下载失败，请稍后重试" });
});
