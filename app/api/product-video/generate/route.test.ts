// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { verifyMediaToken, verifyVideoJobToken } from "@/lib/download-token";
import { resolveKeyframeUrl } from "@/features/product-video/lib/keyframe";
import { submitVideoTask, VideoApiError } from "@/lib/jimeng/video";
import { POST } from "./route";

vi.mock("@/features/product-video/lib/keyframe", () => ({ resolveKeyframeUrl: vi.fn(), keyframeAspect: vi.fn(() => "1024x1536") }));
vi.mock("@/lib/jimeng/video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jimeng/video")>();
  return { ...actual, submitVideoTask: vi.fn() };
});

const settings = { aspectRatio: "9:16", durationSec: 10, language: "zh-CN" };
const shot = { id: "1", title: "开镜特写", description: "黑金背景商品特写，缓慢推进", onScreenText: "96小时超长续航", durationSec: 10 };
const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

function generateForm(options: { imageCount?: number; imageType?: string; shot?: unknown; settings?: unknown } = {}) {
  const form = new FormData();
  const imageCount = options.imageCount ?? 1;
  for (let index = 0; index < imageCount; index += 1) {
    form.append("images", new File([webpBytes], `${index}.webp`, { type: options.imageType ?? "image/webp" }));
  }
  form.append("shot", JSON.stringify(options.shot ?? shot));
  form.append("settings", JSON.stringify(options.settings ?? settings));
  return form;
}

function generateRequest(form = generateForm(), headers: HeadersInit = { "X-Product-Studio-Request": "1" }) {
  return new Request("http://localhost/api/product-video/generate", { method: "POST", body: form, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "grsai-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "download-secret";
  process.env.VIDEO_API_KEY = "video-key";
  vi.mocked(resolveKeyframeUrl).mockResolvedValue("https://cdn.example/kf.png");
  vi.mocked(submitVideoTask).mockResolvedValue("provider-task-1");
});

it("returns 503 before parsing when any provider key is absent", async () => {
  delete process.env.VIDEO_API_KEY;
  const response = await POST(generateRequest());

  expect(response.status).toBe(503);
  expect(resolveKeyframeUrl).not.toHaveBeenCalled();
});

it("rejects a request without the private browser header", async () => {
  expect((await POST(generateRequest(generateForm(), {}))).status).toBe(403);
});

it("rejects an invalid or non-image upload", async () => {
  expect((await POST(generateRequest(generateForm({ imageCount: 0 })))).status).toBe(400);
  expect((await POST(generateRequest(generateForm({ imageType: "image/gif" })))).status).toBe(400);
  expect(resolveKeyframeUrl).not.toHaveBeenCalled();
});

it("rejects an invalid shot payload", async () => {
  const response = await POST(generateRequest(generateForm({ shot: { ...shot, durationSec: 2 } })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "镜头或生成设置无效" });
});

it("submits the video task with the resolved keyframe and returns a signed running task", async () => {
  const response = await POST(generateRequest());
  const body = await response.json();

  expect(resolveKeyframeUrl).toHaveBeenCalledWith(expect.objectContaining({
    images: [expect.stringMatching(/^data:image\/webp;base64,/)],
    aspectRatio: "9:16",
  }));
  expect(vi.mocked(resolveKeyframeUrl).mock.calls[0][0].prompt).toContain("96小时超长续航");
  expect(submitVideoTask).toHaveBeenCalledWith(expect.objectContaining({
    ratio: "9:16",
    durationSec: 10,
    firstFrameUrl: "https://cdn.example/kf.png",
    prompt: expect.stringContaining("96小时超长续航"),
    model: "nd-seedance-2.0-480p",
    resolution: "480p",
  }));

  expect(body.task).toMatchObject({ shotId: "1", status: "running", progress: 0 });
  const verified = verifyVideoJobToken(body.task.providerJobId, "download-secret");
  expect(verified).toEqual({
    providerTaskId: "provider-task-1",
    sceneId: "1",
    aspectRatio: "9:16",
    keyframeUrl: "https://cdn.example/kf.png",
  });
  const keyframeUrl = new URL(body.task.keyframeUrl);
  expect(keyframeUrl.pathname).toBe("/api/product-video/download");
  expect(keyframeUrl.searchParams.get("inline")).toBe("1");
  expect(verifyMediaToken(body.task.keyframeToken, "download-secret")).toEqual({ kind: "keyframe", url: "https://cdn.example/kf.png" });
});

it("selects the 720p model when the settings ask for it", async () => {
  await POST(generateRequest(generateForm({ settings: { ...settings, resolution: "720p" } })));

  expect(submitVideoTask).toHaveBeenCalledWith(expect.objectContaining({
    model: "nd-seedance-2.0-720p",
    resolution: "720p",
  }));
});

it("returns a retryable failed task when the keyframe cannot be resolved", async () => {
  vi.mocked(resolveKeyframeUrl).mockRejectedValueOnce(new Error("关键帧生成失败，请重试此镜头"));
  const response = await POST(generateRequest());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    task: { shotId: "1", status: "failed", progress: 0, error: "关键帧生成失败，请重试此镜头" },
  });
  expect(submitVideoTask).not.toHaveBeenCalled();
});

it("returns a failed task with the provider message when submission fails", async () => {
  vi.mocked(submitVideoTask).mockRejectedValueOnce(new VideoApiError("balance", "视频服务积分或余额不足", 402));
  const response = await POST(generateRequest());

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.task).toMatchObject({ shotId: "1", status: "failed", error: "视频服务积分或余额不足" });
});
