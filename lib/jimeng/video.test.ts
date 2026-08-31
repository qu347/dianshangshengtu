// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { getVideoTask, submitVideoTask, VIDEO_QUALITY_MODELS } from "./video";

beforeEach(() => {
  process.env.VIDEO_API_KEY = "test-key";
  delete process.env.VIDEO_MODEL;
  delete process.env.VIDEO_API_BASE_URL;
  delete process.env.VIDEO_RESOLUTION;
});

it("maps the two quality tiers to their pinned models", () => {
  expect(VIDEO_QUALITY_MODELS).toEqual({
    "480p": "nd-seedance-2.0-480p",
    "720p": "nd-seedance-2.0-720p",
  });
});

it("passes an explicit model and resolution through to the provider", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ task_id: "task-2" }), { status: 200 }),
  );

  await submitVideoTask({
    prompt: "p",
    ratio: "1:1",
    durationSec: 5,
    model: VIDEO_QUALITY_MODELS["720p"],
    resolution: "720p",
  }, fetchImpl);

  const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
  expect(body.model).toBe("nd-seedance-2.0-720p");
  expect(body.resolution).toBe("720p");
});

it.each([
  [VIDEO_QUALITY_MODELS["480p"], "480p", 5],
  [VIDEO_QUALITY_MODELS["720p"], "720p", 15],
])("submits the selected %s model at its %i-second boundary", async (model, resolution, durationSec) => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ task_id: "task-boundary" }), { status: 200 }),
  );

  await expect(submitVideoTask({ prompt: "p", ratio: "1:1", durationSec, model, resolution }, fetchImpl))
    .resolves.toBe("task-boundary");
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it.each([4, 16])("rejects %i seconds for a selected nd-seedance model before fetch", async (durationSec) => {
  const fetchImpl = vi.fn();

  await expect(submitVideoTask({
    prompt: "p",
    ratio: "1:1",
    durationSec,
    model: VIDEO_QUALITY_MODELS["480p"],
    resolution: "480p",
  }, fetchImpl)).rejects.toMatchObject({ code: "invalid_request", status: 400 });
  expect(fetchImpl).not.toHaveBeenCalled();
});

it("does not apply selected-model duration limits to another model", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ task_id: "other-model" }), { status: 200 }),
  );

  await expect(submitVideoTask({
    prompt: "p",
    ratio: "1:1",
    durationSec: 4,
    model: "dvc-seedance-2.5",
  }, fetchImpl)).resolves.toBe("other-model");
  expect(fetchImpl).toHaveBeenCalledOnce();
});

it("submits a video task with the model defaults and returns the task id", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ task_id: "task-1", status: "submitted" }), { status: 200 }),
  );

  const taskId = await submitVideoTask({
    prompt: "商品特写运镜",
    ratio: "9:16",
    durationSec: 10,
    firstFrameUrl: "https://cdn.example/kf.png",
  }, fetchImpl);

  expect(taskId).toBe("task-1");
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe("https://www.jimengvip.online/v1/videos/generations");
  const body = JSON.parse(String(init.body));
  expect(body).toMatchObject({
    model: "dvc-seedance-2.5",
    prompt: "商品特写运镜",
    ratio: "9:16",
    duration: 10,
    resolution: "720p",
    firstFrame: "https://cdn.example/kf.png",
  });
  expect(init.headers.Authorization).toBe("Bearer test-key");
});

it("rejects a submission without a task id", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));

  await expect(submitVideoTask({ prompt: "p", ratio: "1:1", durationSec: 4 }, fetchImpl))
    .rejects.toMatchObject({ code: "upstream", status: 502 });
});

it.each([
  ["completed", { result: "https://cdn.example/clip.mp4" }],
  ["success", { result_url: "https://cdn.example/clip.mp4" }],
])("maps a %s task to success", async (status, extra) => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status, progress: 100, ...extra }), { status: 200 }),
  );

  await expect(getVideoTask("task-1", fetchImpl)).resolves.toEqual({
    status: "succeeded",
    resultUrl: "https://cdn.example/clip.mp4",
  });
});

it("falls back to the video_url field and rejects non-https results", async () => {
  const https = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status: "completed", video_url: "https://cdn.example/clip.mp4" }), { status: 200 }),
  );
  await expect(getVideoTask("task-1", https)).resolves.toMatchObject({ status: "succeeded" });

  const insecure = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status: "completed", result: "http://cdn.example/clip.mp4" }), { status: 200 }),
  );
  await expect(getVideoTask("task-1", insecure)).rejects.toMatchObject({ code: "upstream" });
});

it.each([
  ["pending", 20],
  ["processing", 55],
])("maps a %s task to running with clamped progress", async (status, progress) => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status, progress }), { status: 200 }),
  );

  await expect(getVideoTask("task-1", fetchImpl)).resolves.toEqual({ status: "running", progress });
});

it.each([
  ["failed"],
  ["cancelled"],
])("maps a %s task to a safe failure", async (status) => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ status, error: { message: "raw upstream detail" } }), { status: 200 }),
  );

  await expect(getVideoTask("task-1", fetchImpl)).resolves.toEqual({
    status: "failed",
    error: "视频生成失败，请重试",
  });
});

it("maps provider error statuses without leaking the upstream body", async () => {
  const unauthorized = vi.fn().mockResolvedValue(new Response("api_key_invalid detail", { status: 401 }));
  await expect(getVideoTask("task-1", unauthorized)).rejects.toMatchObject({ code: "auth" });

  const outOfBalance = vi.fn().mockResolvedValue(new Response("balance", { status: 402 }));
  await expect(getVideoTask("task-1", outOfBalance)).rejects.toMatchObject({ code: "balance" });

  const throttled = vi.fn().mockResolvedValue(new Response("duplicate_request", { status: 429 }));
  await expect(getVideoTask("task-1", throttled)).rejects.toMatchObject({ code: "rate_limit", status: 429 });
});

it("fails fast without a configured key", async () => {
  delete process.env.VIDEO_API_KEY;
  const fetchImpl = vi.fn();

  await expect(submitVideoTask({ prompt: "p", ratio: "1:1", durationSec: 4 }, fetchImpl))
    .rejects.toMatchObject({ code: "auth", status: 503 });
  expect(fetchImpl).not.toHaveBeenCalled();
});
