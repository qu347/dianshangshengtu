import type { ShotScript, VideoIntroSettings, VideoIntroTask } from "../model";
import { ProductVideoApiError, submitShotClient } from "./client";

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function pollShotJob(input: {
  providerJobId: string;
  shotId: string;
  api: { status: (jobToken: string, shotId: string, signal?: AbortSignal) => Promise<VideoIntroTask> };
  onShotChange: (task: VideoIntroTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<VideoIntroTask> {
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? 20 * 60 * 1000;
  const startedAt = now();
  let delay = 3000;
  let lastProgress = 0;
  let jobToken = input.providerJobId;

  for (;;) {
    input.signal?.throwIfAborted();
    let task: VideoIntroTask;
    try {
      task = await input.api.status(jobToken, input.shotId, input.signal);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (error instanceof ProductVideoApiError && !error.retryable) {
        const failed: VideoIntroTask = {
          shotId: input.shotId,
          providerJobId: jobToken,
          status: "failed",
          progress: lastProgress,
          error: error.message,
        };
        input.onShotChange(failed);
        return failed;
      }
      const resumable: VideoIntroTask = {
        shotId: input.shotId,
        providerJobId: jobToken,
        status: "failed",
        progress: lastProgress,
        error: "查询视频任务失败，可重试此镜头",
      };
      input.onShotChange(resumable);
      return resumable;
    }
    input.onShotChange(task);
    lastProgress = task.progress;

    // The server re-signs the opaque token on every running-job poll so a
    // leaked token stops working right after this request.
    if (task.providerJobId && task.providerJobId !== jobToken) jobToken = task.providerJobId;

    if (task.status !== "running") return task;
    if (now() - startedAt >= timeoutMs) {
      const timedOut: VideoIntroTask = { ...task, status: "failed", error: "视频生成超时，请重试此镜头", providerJobId: jobToken };
      input.onShotChange(timedOut);
      return timedOut;
    }
    if (input.signal?.aborted) return task;

    await sleep(delay);
    if (input.signal?.aborted) return task;
    delay = Math.min(delay * 2, 8000);
  }
}

export async function runShotBatch(input: {
  shots: ShotScript[];
  productImages: File[];
  settings: VideoIntroSettings;
  api: {
    submit: typeof submitShotClient;
    status: (jobToken: string, shotId: string, signal?: AbortSignal) => Promise<VideoIntroTask>;
  };
  onShotChange: (task: VideoIntroTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<VideoIntroTask[]> {
  const results: VideoIntroTask[] = [];
  const order = new Map(input.shots.map((shot, index) => [shot.id, index]));
  let nextIndex = 0;

  async function runOne(shot: ShotScript) {
    input.signal?.throwIfAborted();
    input.onShotChange({ shotId: shot.id, status: "submitting", progress: 0 });
    try {
      const submitted = await input.api.submit({
        productImages: input.productImages,
        shot,
        settings: input.settings,
        signal: input.signal,
      });
      if (input.signal?.aborted) return;
      input.onShotChange(submitted);
      let result = submitted;
      if (submitted.status === "queued" || submitted.status === "submitting" || submitted.status === "running") {
        if (!submitted.providerJobId) {
          result = { ...submitted, status: "failed", error: "视频任务未返回任务编号，可重试" };
          input.onShotChange(result);
        } else {
          result = await pollShotJob({
            providerJobId: submitted.providerJobId,
            shotId: shot.id,
            api: input.api,
            onShotChange: input.onShotChange,
            signal: input.signal,
            sleep: input.sleep,
            now: input.now,
            timeoutMs: input.timeoutMs,
          });
        }
      }
      results.push(result);
    } catch (error) {
      if (input.signal?.aborted) return;
      const failed: VideoIntroTask = {
        shotId: shot.id,
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "视频任务失败",
      };
      input.onShotChange(failed);
      results.push(failed);
    }
  }

  async function worker() {
    while (nextIndex < input.shots.length && !input.signal?.aborted) {
      await runOne(input.shots[nextIndex++]);
    }
  }

  const workerCount = Math.min(2, input.shots.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results.sort((left, right) => (
    (order.get(left.shotId) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.shotId) ?? Number.MAX_SAFE_INTEGER)
  ));
}
