// @vitest-environment node

import { afterEach, expect, it, vi } from "vitest";
import { getSceneStatusClient, submitSceneClient } from "./client";

afterEach(() => vi.unstubAllGlobals());

it("passes the caller signal to submission fetch and aborts the in-flight request", async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  }));
  vi.stubGlobal("fetch", fetchMock);

  const pending = submitSceneClient({
    productImages: [],
    modelImage: null,
    scene: { id: "1", title: "开场", description: "商品特写", onScreenText: "", durationSec: 5 },
    settings: { aspectRatio: "9:16", durationSec: 5, language: "zh-CN", quality: "480p" },
    signal: controller.signal,
  });
  controller.abort(new DOMException("cancelled", "AbortError"));

  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledWith("/api/video-remake/generate", expect.objectContaining({ signal: controller.signal }));
});

it("passes the same caller signal to polling fetch", async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    task: { sceneId: "1", status: "running", progress: 30, providerJobId: "next-token" },
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);

  await getSceneStatusClient("job-token", "1", controller.signal);

  expect(fetchMock).toHaveBeenCalledWith("/api/video-remake/jobs/job-token", expect.objectContaining({ signal: controller.signal }));
});
