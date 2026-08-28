import type {
  ClothingGenerationSettings,
  ClothingGenerationTask,
  ClothingPlanItem,
  ReferenceAsset,
} from "../model";
import { ClothingStudioApiError, type ClothingStudioApi } from "./client-api";

const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, milliseconds);
});

export async function pollClothingJob(input: {
  providerJobId: string;
  planItemId: string;
  api: Pick<ClothingStudioApi, "status">;
  onTaskChange: (task: ClothingGenerationTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
}) {
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const timeoutMs = input.timeoutMs ?? 20 * 60 * 1000;
  const startedAt = now();
  let delay = 2000;
  let lastProgress = 0;

  while (true) {
    input.signal?.throwIfAborted();
    let task: ClothingGenerationTask;
    try {
      task = await input.api.status(input.providerJobId, input.planItemId);
    } catch (error) {
      const failed = error instanceof ClothingStudioApiError && !error.retryable;
      const task: ClothingGenerationTask = {
        planItemId: input.planItemId,
        providerJobId: input.providerJobId,
        status: failed ? "failed" : "timed_out",
        progress: lastProgress,
        error: failed ? error.message : "查询生图任务失败，可继续查询",
      };
      input.onTaskChange(task);
      return task;
    }
    input.onTaskChange(task);
    lastProgress = task.progress;
    if (task.status !== "running") return task;
    if (now() - startedAt >= timeoutMs) {
      const timedOut: ClothingGenerationTask = {
        ...task,
        providerJobId: input.providerJobId,
        status: "timed_out",
      };
      input.onTaskChange(timedOut);
      return timedOut;
    }
    await sleep(delay);
    if (input.signal?.aborted) return task;
    delay = Math.min(delay * 2, 8000);
  }
}

export async function runCandidateBatch(input: {
  tasks: ClothingGenerationTask[];
  api: Pick<ClothingStudioApi, "status">;
  onTaskChange: (task: ClothingGenerationTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  return Promise.all(input.tasks.map((task) => {
    if (task.status !== "running" || !task.providerJobId) return Promise.resolve(task);
    return pollClothingJob({
      providerJobId: task.providerJobId,
      planItemId: task.planItemId,
      api: input.api,
      onTaskChange: input.onTaskChange,
      signal: input.signal,
      sleep: input.sleep,
    });
  }));
}

type GenerationApi = Pick<ClothingStudioApi, "submit" | "status">;

export async function runClothingGenerationBatch(input: {
  items: ClothingPlanItem[];
  garments: File[];
  settings: ClothingGenerationSettings;
  model: ReferenceAsset;
  scene?: ReferenceAsset | null;
  api: GenerationApi;
  onTaskChange: (task: ClothingGenerationTask) => void;
  signal?: AbortSignal;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  baseImageToken?: string;
}) {
  const results: ClothingGenerationTask[] = [];
  const order = new Map(input.items.map((item, index) => [item.id, index]));

  async function runOne(item: ClothingPlanItem, baseImageToken?: string) {
    let providerJobId: string | undefined;
    input.onTaskChange({ planItemId: item.id, status: "submitting", progress: 0 });
    try {
      const submitted = await input.api.submit({
        garments: input.garments,
        settings: input.settings,
        item,
        ...(item.id === "1" ? {} : {
          model: input.model,
          scene: input.scene,
          ...(baseImageToken ? { baseImageToken } : {}),
        }),
      });
      if (input.signal?.aborted) return undefined;
      providerJobId = submitted.providerJobId;
      input.onTaskChange(submitted);
      if (submitted.status !== "running") return submitted;
      if (!providerJobId) throw new Error("生图服务未返回任务 ID");
      return pollClothingJob({
        providerJobId,
        planItemId: item.id,
        api: input.api,
        onTaskChange: input.onTaskChange,
        signal: input.signal,
        sleep: input.sleep,
        now: input.now,
        timeoutMs: input.timeoutMs,
      });
    } catch (error) {
      if (input.signal?.aborted) return undefined;
      const failed: ClothingGenerationTask = {
        planItemId: item.id,
        ...(providerJobId ? { providerJobId } : {}),
        status: "failed",
        progress: 0,
        error: error instanceof Error ? error.message : "生图任务失败",
      };
      input.onTaskChange(failed);
      return failed;
    }
  }

  const imageOne = input.items.find((item) => item.id === "1");
  let baseImageToken = input.baseImageToken;
  const laterItems = imageOne ? input.items.filter((item) => item.id !== "1") : input.items;
  if (imageOne) {
    let main = await runOne(imageOne);
    const mainError = main?.error ?? "";
    const whiteFailure = main?.status === "failed"
      && (mainError.includes("白底服装主图") || mainError.includes("白底商品主图"));
    if (whiteFailure && !input.signal?.aborted) main = await runOne(imageOne);
    if (main) results.push(main);
    baseImageToken = main?.status === "succeeded" ? main.downloadToken : undefined;
  }

  if (!baseImageToken) {
    for (const item of laterItems) {
      const blocked: ClothingGenerationTask = {
        planItemId: item.id,
        status: "failed",
        progress: 0,
        error: "请先生成或重试白底立体服装主图",
      };
      input.onTaskChange(blocked);
      results.push(blocked);
    }
    return results.sort((left, right) => (order.get(left.planItemId)! - order.get(right.planItemId)!));
  }

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < laterItems.length && !input.signal?.aborted) {
      const item = laterItems[nextIndex++];
      const task = await runOne(item, baseImageToken);
      if (task) results.push(task);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, laterItems.length) }, worker));
  return results.sort((left, right) => (order.get(left.planItemId)! - order.get(right.planItemId)!));
}
