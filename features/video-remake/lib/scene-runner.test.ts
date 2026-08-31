import { expect, it, vi } from "vitest";
import { runSceneBatch } from "./scene-runner";

it("passes its signal into submission and stops before submitting a later scene after cancellation", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const submit = vi.fn(async (input: { scene: { id: string }; signal?: AbortSignal }) => {
    receivedSignal = input.signal;
    controller.abort();
    return { sceneId: input.scene.id, status: "running" as const, progress: 0, providerJobId: "job-1" };
  });

  await runSceneBatch({
    scenes: [
      { id: "1", title: "开场", description: "商品特写", onScreenText: "", durationSec: 5 },
      { id: "2", title: "结尾", description: "商品全景", onScreenText: "", durationSec: 5 },
    ],
    productImages: [],
    modelImage: null,
    settings: { aspectRatio: "9:16", durationSec: 10, language: "zh-CN", quality: "480p" },
    api: {
      submit: submit as never,
      status: vi.fn(),
    },
    onSceneChange: vi.fn(),
    signal: controller.signal,
  });

  expect(receivedSignal).toBe(controller.signal);
  expect(submit).toHaveBeenCalledTimes(1);
});

it("passes the same signal into polling", async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;

  await runSceneBatch({
    scenes: [{ id: "1", title: "开场", description: "商品特写", onScreenText: "", durationSec: 5 }],
    productImages: [],
    modelImage: null,
    settings: { aspectRatio: "9:16", durationSec: 5, language: "zh-CN", quality: "480p" },
    api: {
      submit: vi.fn().mockResolvedValue({ sceneId: "1", status: "running", progress: 20, providerJobId: "job-1" }),
      status: vi.fn(async (_jobToken, _sceneId, signal?: AbortSignal) => {
        receivedSignal = signal;
        controller.abort();
        return { sceneId: "1", status: "running" as const, progress: 20, providerJobId: "job-1" };
      }),
    },
    onSceneChange: vi.fn(),
    signal: controller.signal,
  });

  expect(receivedSignal).toBe(controller.signal);
});
