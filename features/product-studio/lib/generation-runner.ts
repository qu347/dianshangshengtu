import type { GenerationSettings, GenerationTask, PlanItem } from "../model";
import { ProductStudioApiError, type ProductStudioApi } from "./client-api";

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
  const timeoutMs = input.timeoutMs ?? 20 * 60 * 1000;
  const startedAt = now();
  let delay = 2000;
  let lastProgress = 0;

  while (true) {
    input.signal?.throwIfAborted();
    let task: GenerationTask;
    try {
      task = await input.api.status(input.providerJobId, input.planItemId);
    } catch (error) {
      if (error instanceof ProductStudioApiError && !error.retryable) {
        const failed: GenerationTask = {
          planItemId: input.planItemId,
          providerJobId: input.providerJobId,
          status: "failed",
          progress: lastProgress,
          error: error.message,
        };
        input.onTaskChange(failed);
        return failed;
      }
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
  baseImageToken?: string;
}): Promise<GenerationTask[]> {
  const results: GenerationTask[] = [];
  const itemOrder = new Map(input.items.map((item, index) => [item.id, index]));
  let nextIndex = 0;

  async function runOne(item: PlanItem, baseImageToken?: string) {
    let providerJobId: string | undefined;
    input.onTaskChange({ planItemId: item.id, status: "submitting", progress: 0 });

    try {
      const submitted = await input.api.submit({
        files: input.files,
        settings: input.settings,
        item,
        ...(baseImageToken ? { baseImageToken } : {}),
      });
      if (input.signal?.aborted) return undefined;
      providerJobId = submitted.providerJobId;
      input.onTaskChange(submitted);
      if (submitted.status !== "running") {
        results.push(submitted);
        return submitted;
      }
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
      return result;
    } catch (error) {
      if (input.signal?.aborted) return undefined;
      const failed: GenerationTask = {
        planItemId: item.id,
        ...(providerJobId ? { providerJobId } : {}),
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "生图任务失败",
      };
      input.onTaskChange(failed);
      results.push(failed);
      return failed;
    }
  }

  function blockDependentImage(item: PlanItem) {
    const failed: GenerationTask = {
      planItemId: item.id,
      status: "failed",
      progress: 0,
      error: "请先生成或重试白底商品主图",
    };
    input.onTaskChange(failed);
    results.push(failed);
  }

  if (!input.settings.generateDimensionImage) {
    const independentItems = input.items;
    async function independentWorker() {
      while (nextIndex < independentItems.length && !input.signal?.aborted) {
        await runOne(independentItems[nextIndex++]);
      }
    }

    const workerCount = Math.min(3, independentItems.length);
    await Promise.all(Array.from({ length: workerCount }, independentWorker));
    return results.sort((left, right) => (
      (itemOrder.get(left.planItemId) ?? Number.MAX_SAFE_INTEGER)
      - (itemOrder.get(right.planItemId) ?? Number.MAX_SAFE_INTEGER)
    ));
  }

  const imageOne = input.items.find((item) => item.id === "1");
  let baseImageToken = input.baseImageToken;
  let remainingItems = input.items;
  if (imageOne) {
    const imageOneResult = await runOne(imageOne);
    baseImageToken = imageOneResult?.status === "succeeded"
      ? imageOneResult.downloadToken
      : undefined;
    remainingItems = input.items.filter((item) => item !== imageOne);
  }

  async function worker() {
    while (nextIndex < remainingItems.length && !input.signal?.aborted) {
      const item = remainingItems[nextIndex++];
      if (item.id === "2" && !baseImageToken) {
        blockDependentImage(item);
        continue;
      }
      await runOne(item, item.id === "2" ? baseImageToken : undefined);
    }
  }

  const workerCount = Math.min(3, remainingItems.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results.sort((left, right) => (
    (itemOrder.get(left.planItemId) ?? Number.MAX_SAFE_INTEGER)
    - (itemOrder.get(right.planItemId) ?? Number.MAX_SAFE_INTEGER)
  ));
}
