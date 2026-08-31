// @vitest-environment node

import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { beforeEach, expect, it, vi, type Mock } from "vitest";
import { signClipUrl } from "@/lib/download-token";
import { fetchPublicVideo } from "@/lib/remote-image";
import { POST } from "./route";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFile: vi.fn() };
});
vi.mock("@/lib/remote-image", () => ({ fetchPublicVideo: vi.fn() }));

const secret = "test-secret";
const merged = Buffer.from("merged-video-bytes");
const requestHeaders = { "X-Product-Studio-Request": "1", "Content-Type": "application/json" };

function tokensFor() {
  return [
    signClipUrl("https://cdn.example/clip-1.mp4", secret),
    signClipUrl("https://cdn.example/clip-2.mp4", secret),
  ];
}

function mergeRequest(body: string, headers: HeadersInit = requestHeaders) {
  return new Request("http://localhost/api/product-video/merge", { method: "POST", body, headers });
}

function tokensRequest(tokens: string[]) {
  return mergeRequest(JSON.stringify({ tokens }));
}

type FfmpegMode = "ok" | "needs-fallback" | "always-fails";

function mockFfmpeg(mode: FfmpegMode | "version-fails" = "ok") {
  let calls = 0;
  (execFile as unknown as Mock).mockImplementation(async (...fnArgs: unknown[]) => {
    const args = fnArgs[1] as string[];
    const callback = fnArgs[fnArgs.length - 1] as (error: Error | null) => void;
    if (args.includes("-version")) {
      callback(mode === "version-fails" ? new Error("ffmpeg exited non-zero") : null);
      return;
    }
    calls += 1;
    if (mode === "always-fails" || (mode === "needs-fallback" && calls === 1)) {
      callback(new Error("ffmpeg exited non-zero"));
      return;
    }
    await writeFile(args[args.length - 1], merged);
    callback(null);
  });
}

function ffmpegCalls() {
  return (execFile as unknown as Mock).mock.calls
    .map((call) => call[1] as string[])
    .filter((args) => !args.includes("-version"));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = secret;
  delete process.env.FFMPEG_PATH;
  vi.mocked(fetchPublicVideo).mockResolvedValue(Buffer.from("clip-bytes"));
});

it("rejects a request without the private browser header", async () => {
  const response = await POST(mergeRequest(JSON.stringify({ tokens: tokensFor() }), {}));

  expect(response.status).toBe(403);
  expect(execFile).not.toHaveBeenCalled();
});

it("returns 503 without the signing secret", async () => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;
  expect((await POST(tokensRequest(tokensFor()))).status).toBe(503);
  expect(fetchPublicVideo).not.toHaveBeenCalled();
});

it("rejects malformed payloads and token counts", async () => {
  expect((await POST(mergeRequest("not-json"))).status).toBe(400);
  expect((await POST(tokensRequest([signClipUrl("https://cdn.example/a.mp4", secret)]))).status).toBe(400);
  expect((await POST(tokensRequest([
    signClipUrl("https://cdn.example/a.mp4", secret),
    signClipUrl("https://cdn.example/b.mp4", secret),
    signClipUrl("https://cdn.example/c.mp4", secret),
    signClipUrl("https://cdn.example/d.mp4", secret),
    signClipUrl("https://cdn.example/e.mp4", secret),
    signClipUrl("https://cdn.example/f.mp4", secret),
    signClipUrl("https://cdn.example/g.mp4", secret),
  ]))).status).toBe(400);
  expect(fetchPublicVideo).not.toHaveBeenCalled();
});

it("rejects missing or tampered tokens before downloading", async () => {
  const valid = tokensFor();
  const tampered = `${valid[0].slice(0, -1)}${valid[0].endsWith("A") ? "B" : "A"}`;
  expect((await POST(tokensRequest([valid[0], tampered]))).status).toBe(400);
  expect(fetchPublicVideo).not.toHaveBeenCalled();
  expect(execFile).not.toHaveBeenCalled();
});

it.each([
  ["a missing configured executable", "C:\\missing-product-video-ffmpeg.exe"],
  ["a configured directory", process.cwd()],
])("returns a configuration error for %s before downloading clips or creating a merge directory", async (_label, executable) => {
  process.env.FFMPEG_PATH = executable;
  mockFfmpeg("ok");

  const response = await POST(tokensRequest(tokensFor()));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "视频合并服务配置无效：请检查 FFMPEG_PATH 或 PATH 中的 ffmpeg" });
  expect(fetchPublicVideo).not.toHaveBeenCalled();
  expect(execFile).not.toHaveBeenCalled();
});

it("returns a configuration error when ffmpeg version validation fails before downloading", async () => {
  mockFfmpeg("version-fails");

  const response = await POST(tokensRequest(tokensFor()));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "视频合并服务配置无效：请检查 FFMPEG_PATH 或 PATH 中的 ffmpeg" });
  expect(fetchPublicVideo).not.toHaveBeenCalled();
  expect((execFile as unknown as Mock).mock.calls.map((call) => call[1] as string[])).toEqual([["-version"]]);
});

it("concatenates clips losslessly and returns the merged mp4", async () => {
  mockFfmpeg("ok");
  const response = await POST(tokensRequest(tokensFor()));

  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("video/mp4");
  expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=\"product-video-merged.mp4\"");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(Buffer.from(await response.arrayBuffer())).toEqual(merged);

  expect(fetchPublicVideo).toHaveBeenNthCalledWith(1, "https://cdn.example/clip-1.mp4");
  expect(fetchPublicVideo).toHaveBeenNthCalledWith(2, "https://cdn.example/clip-2.mp4");

  const calls = ffmpegCalls();
  expect(calls).toHaveLength(1);
  expect(calls[0]).toContain("-c");
  expect(calls[0][calls[0].indexOf("-c") + 1]).toBe("copy");
  expect(calls[0][calls[0].length - 1]).toMatch(/merged\.mp4$/);
});

it("falls back to a re-encode when stream copy fails", async () => {
  mockFfmpeg("needs-fallback");
  const response = await POST(tokensRequest(tokensFor()));

  expect(response.status).toBe(200);
  const calls = ffmpegCalls();
  expect(calls).toHaveLength(2);
  expect(calls[1]).toContain("libx264");
});

it("maps total ffmpeg failure to a proxy error", async () => {
  mockFfmpeg("always-fails");
  const response = await POST(tokensRequest(tokensFor()));

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "视频合并失败，请稍后重试" });
});
