import { expect, it } from "vitest";
import type { VideoRemakeState } from "./state";
import { videoRemakeReducer } from "./state";

it("queues only the retried failed scene while preserving completed result objects", () => {
  const firstCompleted = {
    sceneId: "1",
    status: "succeeded" as const,
    progress: 100,
    resultUrl: "https://cdn.example/first.mp4",
    downloadToken: "first-download-token",
  };
  const secondCompleted = {
    sceneId: "2",
    status: "succeeded" as const,
    progress: 100,
    resultUrl: "https://cdn.example/second.mp4",
    downloadToken: "second-download-token",
  };
  const failed = { sceneId: "3", status: "failed" as const, progress: 40, error: "provider timed out" };
  const state = {
    phase: "completed",
    referenceVideo: null,
    frames: [],
    videoDurationSec: 0,
    modelImage: null,
    productImages: [],
    productName: "",
    requirements: "",
    settings: { aspectRatio: "9:16", durationSec: 15, language: "zh-CN", quality: "480p" },
    script: null,
    tasks: [firstCompleted, secondCompleted, failed],
    notice: null,
  } satisfies VideoRemakeState;

  const next = videoRemakeReducer(state, { type: "scene_retry_started", sceneId: "3" });

  expect(next.tasks[0]).toBe(firstCompleted);
  expect(next.tasks[1]).toBe(secondCompleted);
  expect(next.tasks).toEqual([
    firstCompleted,
    secondCompleted,
    { sceneId: "3", status: "queued", progress: 0 },
  ]);
});
