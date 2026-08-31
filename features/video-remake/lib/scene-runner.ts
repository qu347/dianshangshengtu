import type { SceneScript, VideoRemakeSettings, VideoSceneTask } from "../model";
import { VideoRemakeApiError, submitSceneClient } from "./client";

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function pollSceneJob(input: {
  providerJobId: string;
  sceneId: string;
  api: { status: (jobToken: string, sceneId: string, signal?: AbortSignal) => Promise<VideoSceneTask> };
  onSceneChange: (task: VideoSceneTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<VideoSceneTask> {
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? 20 * 60 * 1000;
  const startedAt = now();
  let delay = 3000;
  let lastProgress = 0;
  let jobToken = input.providerJobId;

  for (;;) {
    input.signal?.throwIfAborted();
    let task: VideoSceneTask;
    try {
      task = await input.api.status(jobToken, input.sceneId, input.signal);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (error instanceof VideoRemakeApiError && !error.retryable) {
        const failed: VideoSceneTask = {
          sceneId: input.sceneId,
          providerJobId: jobToken,
          status: "failed",
          progress: lastProgress,
          error: error.message,
        };
        input.onSceneChange(failed);
        return failed;
      }
      const resumable: VideoSceneTask = {
        sceneId: input.sceneId,
        providerJobId: jobToken,
        status: "failed",
        progress: lastProgress,
        error: "查询视频任务失败，可重试此分镜",
      };
      input.onSceneChange(resumable);
      return resumable;
    }
    input.onSceneChange(task);
    lastProgress = task.progress;

    // The server re-signs the opaque token on every running-job poll so a
    // leaked token stops working right after this request.
    if (task.providerJobId && task.providerJobId !== jobToken) jobToken = task.providerJobId;

    if (task.status !== "running") return task;
    if (now() - startedAt >= timeoutMs) {
      const timedOut: VideoSceneTask = { ...task, status: "failed", error: "视频生成超时，请重试此分镜", providerJobId: jobToken };
      input.onSceneChange(timedOut);
      return timedOut;
    }
    if (input.signal?.aborted) return task;

    await sleep(delay);
    if (input.signal?.aborted) return task;
    delay = Math.min(delay * 2, 8000);
  }
}

export async function runSceneBatch(input: {
  scenes: SceneScript[];
  productImages: File[];
  modelImage: File | null;
  settings: VideoRemakeSettings;
  api: {
    submit: typeof submitSceneClient;
    status: (jobToken: string, sceneId: string, signal?: AbortSignal) => Promise<VideoSceneTask>;
  };
  onSceneChange: (task: VideoSceneTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<VideoSceneTask[]> {
  const results: VideoSceneTask[] = [];
  const order = new Map(input.scenes.map((scene, index) => [scene.id, index]));
  let nextIndex = 0;

  async function runOne(scene: SceneScript) {
    input.signal?.throwIfAborted();
    input.onSceneChange({ sceneId: scene.id, status: "submitting", progress: 0 });
    try {
      const submitted = await input.api.submit({
        productImages: input.productImages,
        modelImage: input.modelImage,
        scene,
        settings: input.settings,
        signal: input.signal,
      });
      if (input.signal?.aborted) return;
      input.onSceneChange(submitted);
      let result = submitted;
      if (submitted.status === "running" && submitted.providerJobId) {
        result = await pollSceneJob({
          providerJobId: submitted.providerJobId,
          sceneId: scene.id,
          api: input.api,
          onSceneChange: input.onSceneChange,
          signal: input.signal,
          sleep: input.sleep,
          now: input.now,
          timeoutMs: input.timeoutMs,
        });
      }
      results.push(result);
    } catch (error) {
      if (input.signal?.aborted) return;
      const failed: VideoSceneTask = {
        sceneId: scene.id,
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "视频任务失败",
      };
      input.onSceneChange(failed);
      results.push(failed);
    }
  }

  async function worker() {
    while (nextIndex < input.scenes.length && !input.signal?.aborted) {
      await runOne(input.scenes[nextIndex++]);
    }
  }

  const workerCount = Math.min(2, input.scenes.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results.sort((left, right) => (
    (order.get(left.sceneId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.sceneId) ?? Number.MAX_SAFE_INTEGER)
  ));
}
