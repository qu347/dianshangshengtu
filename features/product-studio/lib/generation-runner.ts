import type { GenerationSettings, GenerationTask, PlanItem } from "../model";
import type { ProductStudioApi } from "./client-api";

type GenerationApi = Pick<ProductStudioApi, "submit" | "status">;

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function pollGenerationJob(input: {
  providerJobId: string;
  planItemId: string;
  api: Pick<ProductStudioApi, "status">;
  onTaskChange: (task: GenerationTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<GenerationTask> {
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000;
  const startedAt = now();
  let delay = 2000;
  let lastProgress = 0;

  while (true) {
    input.signal?.throwIfAborted();
    let task: GenerationTask;
    try {
      task = await input.api.status(input.providerJobId, input.planItemId);
    } catch {
      const resumable: GenerationTask = {
        planItemId: input.planItemId,
        providerJobId: input.providerJobId,
        status: "timed_out",
        progress: lastProgress,
        error: "查询生图任务失败，可继续查询",
      };
      input.onTaskChange(resumable);
      return resumable;
    }
    input.onTaskChange(task);
    lastProgress = task.progress;

    if (task.status !== "running") return task;
    if (now() - startedAt >= timeoutMs) {
      const timedOut: GenerationTask = { ...task, status: "timed_out", providerJobId: input.providerJobId };
      input.onTaskChange(timedOut);
      return timedOut;
    }
    if (input.signal?.aborted) return task;

    await sleep(delay);
    if (input.signal?.aborted) return task;
    delay = Math.min(delay * 2, 8000);
  }
}

export async function runGenerationBatch(input: {
  items: PlanItem[];
  files: File[];
  settings: GenerationSettings;
  api: GenerationApi;
  onTaskChange: (task: GenerationTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<GenerationTask[]> {
  const results: GenerationTask[] = [];
  let nextIndex = 0;

  async function runOne(item: PlanItem) {
    let providerJobId: string | undefined;
    input.onTaskChange({ planItemId: item.id, status: "submitting", progress: 0 });

    try {
      const submitted = await input.api.submit({ files: input.files, settings: input.settings, item });
      if (input.signal?.aborted) return;
      providerJobId = submitted.providerJobId;
      input.onTaskChange(submitted);
      if (!providerJobId) throw new Error("生图服务未返回任务 ID");

      const result = await pollGenerationJob({
        providerJobId,
        planItemId: item.id,
        api: input.api,
        onTaskChange: input.onTaskChange,
        signal: input.signal,
        sleep: input.sleep,
        now: input.now,
        timeoutMs: input.timeoutMs,
      });
      results.push(result);
    } catch (error) {
      if (input.signal?.aborted) return;
      const failed: GenerationTask = {
        planItemId: item.id,
        ...(providerJobId ? { providerJobId } : {}),
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "生图任务失败",
      };
      input.onTaskChange(failed);
      results.push(failed);
    }
  }

  async function worker() {
    while (nextIndex < input.items.length && !input.signal?.aborted) {
      const item = input.items[nextIndex++];
      await runOne(item);
    }
  }

  const workerCount = Math.min(3, input.items.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
