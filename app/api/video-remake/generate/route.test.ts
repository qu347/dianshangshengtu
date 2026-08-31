// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { verifyMediaToken, verifyVideoJobToken } from "@/lib/download-token";
import { resolveKeyframeUrl } from "@/features/video-remake/lib/keyframe";
import { resolveClothingReference } from "@/lib/clothing-reference";
import { submitVideoTask, VideoApiError } from "@/lib/jimeng/video";
import { POST } from "./route";

vi.mock("@/features/video-remake/lib/keyframe", () => ({ resolveKeyframeUrl: vi.fn() }));
vi.mock("@/lib/clothing-reference", () => ({ resolveClothingReference: vi.fn() }));
vi.mock("@/lib/jimeng/video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jimeng/video")>();
  return { ...actual, submitVideoTask: vi.fn() };
});

const settings = { aspectRatio: "9:16", durationSec: 10, language: "zh-CN" };
const scene = { id: "1", title: "开镜", description: "商品特写，缓慢推进", onScreenText: "96小时续航", durationSec: 10 };
const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

function generateForm() {
  const form = new FormData();
  form.append("images", new File([webpBytes], "p.webp", { type: "image/webp" }));
  form.append("scene", JSON.stringify(scene));
  form.append("settings", JSON.stringify(settings));
  return form;
}

function generateRequest() {
  return new Request("http://localhost/api/video-remake/generate", {
    method: "POST",
    body: generateForm(),
    headers: { "X-Product-Studio-Request": "1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "grsai-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "download-secret";
  process.env.VIDEO_API_KEY = "video-key";
  vi.mocked(resolveKeyframeUrl).mockResolvedValue("https://cdn.example/kf.png");
  vi.mocked(resolveClothingReference).mockResolvedValue(undefined);
  vi.mocked(submitVideoTask).mockResolvedValue("provider-task-1");
});

it("returns 503 before parsing when any provider key is absent", async () => {
  delete process.env.VIDEO_API_KEY;
  const response = await POST(generateRequest());

  expect(response.status).toBe(503);
  expect(resolveKeyframeUrl).not.toHaveBeenCalled();
});

it("rejects a request without the private browser header", async () => {
  const request = new Request("http://localhost/api/video-remake/generate", {
    method: "POST",
    body: generateForm(),
  });
  expect((await POST(request)).status).toBe(403);
});

it("rejects an invalid scene payload", async () => {
  const form = generateForm();
  form.set("scene", JSON.stringify({ ...scene, durationSec: 2 }));
  const response = await POST(new Request("http://localhost/api/video-remake/generate", {
    method: "POST",
    body: form,
    headers: { "X-Product-Studio-Request": "1" },
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "分镜或生成设置无效" });
});

it("submits the video task with the resolved keyframe and returns a signed running task", async () => {
  const response = await POST(generateRequest());
  const body = await response.json();

  expect(resolveKeyframeUrl).toHaveBeenCalledWith(expect.objectContaining({
    images: [expect.stringMatching(/^data:image\/webp;base64,/)],
    aspectRatio: "9:16",
  }));
  expect(submitVideoTask).toHaveBeenCalledWith(expect.objectContaining({
    ratio: "9:16",
    durationSec: 10,
    firstFrameUrl: "https://cdn.example/kf.png",
    prompt: expect.stringContaining("96小时续航"),
    model: "nd-seedance-2.0-480p",
    resolution: "480p",
  }));

  expect(body.task).toMatchObject({ sceneId: "1", status: "running", progress: 0 });
  const verified = verifyVideoJobToken(body.task.providerJobId, "download-secret");
  expect(verified).toEqual({
    providerTaskId: "provider-task-1",
    sceneId: "1",
    aspectRatio: "9:16",
    keyframeUrl: "https://cdn.example/kf.png",
  });
  const keyframeUrl = new URL(body.task.keyframeUrl);
  expect(keyframeUrl.pathname).toBe("/api/video-remake/download");
  expect(keyframeUrl.searchParams.get("inline")).toBe("1");
  expect(verifyMediaToken(body.task.keyframeToken, "download-secret")).toEqual({
    kind: "keyframe",
    url: "https://cdn.example/kf.png",
  });
});

it("resolves an AI-generated model token into the keyframe references", async () => {
  const form = generateForm();
  form.append("modelToken", "signed-model-token");
  vi.mocked(resolveClothingReference).mockResolvedValueOnce("data:image/png;base64,bW9kZWw=");

  const response = await POST(new Request("http://localhost/api/video-remake/generate", {
    method: "POST",
    body: form,
    headers: { "X-Product-Studio-Request": "1" },
  }));

  expect(response.status).toBe(200);
  expect(resolveKeyframeUrl).toHaveBeenCalledWith(expect.objectContaining({
    images: [expect.stringMatching(/^data:image\/webp;base64,/), "data:image/png;base64,bW9kZWw="],
  }));
});

it("rejects an invalid AI-generated model token", async () => {
  const form = generateForm();
  form.append("modelToken", "invalid-model-token");
  vi.mocked(resolveClothingReference).mockRejectedValueOnce(new Error("模特参考图来源无效"));

  const response = await POST(new Request("http://localhost/api/video-remake/generate", {
    method: "POST",
    body: form,
    headers: { "X-Product-Studio-Request": "1" },
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "模特参考图来源无效" });
  expect(resolveKeyframeUrl).not.toHaveBeenCalled();
});

it("returns a retryable failed task when the keyframe cannot be resolved", async () => {
  vi.mocked(resolveKeyframeUrl).mockRejectedValueOnce(new Error("关键帧生成失败，请重试此分镜"));
  const response = await POST(generateRequest());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    task: { sceneId: "1", status: "failed", progress: 0, error: "关键帧生成失败，请重试此分镜" },
  });
  expect(submitVideoTask).not.toHaveBeenCalled();
});

it("returns a failed task with the provider message when submission fails", async () => {
  vi.mocked(submitVideoTask).mockRejectedValueOnce(new VideoApiError("balance", "视频服务积分或余额不足", 402));
  const response = await POST(generateRequest());

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.task).toMatchObject({ sceneId: "1", status: "failed", error: "视频服务积分或余额不足" });
});
