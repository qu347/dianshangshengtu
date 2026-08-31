import { expect, it } from "vitest";
import type { ProductVideoState } from "./state";
import { productVideoReducer } from "./state";

const succeeded = (shotId: string, token: string) => ({
  shotId,
  status: "succeeded" as const,
  progress: 100,
  resultUrl: `https://cdn.example/${shotId}.mp4`,
  downloadToken: token,
});

function stateWith(tasks: ProductVideoState["tasks"]): ProductVideoState {
  return {
    phase: "generating",
    productImages: [],
    productName: "",
    requirements: "",
    settings: { aspectRatio: "9:16", durationSec: 10, resolution: "480p", language: "zh-CN" },
    script: null,
    tasks,
    notice: null,
  };
}

it("queues only the retried failed shot while preserving completed result objects", () => {
  const first = succeeded("1", "first-download-token");
  const second = succeeded("2", "second-download-token");
  const failed = { shotId: "3", status: "failed" as const, progress: 40, error: "provider timed out" };

  const next = productVideoReducer(stateWith([first, second, failed]), {
    type: "shot_retry_started",
    shotId: "3",
  });

  expect(next.tasks[0]).toBe(first);
  expect(next.tasks[1]).toBe(second);
  expect(next.tasks).toEqual([first, second, { shotId: "3", status: "queued", progress: 0 }]);
});

it("derives completed, partial_failed, and failed phases from final shot outcomes", () => {
  const first = succeeded("1", "first-download-token");
  const failed = { shotId: "2", status: "failed" as const, progress: 0, error: "provider timed out" };
  const state = stateWith([first, failed]);

  expect(productVideoReducer(state, { type: "generation_completed", tasks: [first] }).phase).toBe("completed");
  expect(productVideoReducer(state, { type: "generation_completed", tasks: [first, failed] }).phase).toBe("partial_failed");
  expect(productVideoReducer(state, { type: "generation_completed", tasks: [failed] }).phase).toBe("failed");
});

it("fails an empty completion with a recoverable notice", () => {
  const next = productVideoReducer(stateWith([]), { type: "generation_completed", tasks: [] });

  expect(next.phase).toBe("failed");
  expect(next.tasks).toEqual([]);
  expect(next.notice).toBe("没有可完成的视频任务，请重新生成");
});

it("converts a queued completion into a retryable failure", () => {
  const queued = { shotId: "1", status: "queued" as const, progress: 0 };

  const next = productVideoReducer(stateWith([queued]), { type: "generation_completed", tasks: [queued] });

  expect(next.phase).toBe("failed");
  expect(next.tasks).toEqual([{ ...queued, status: "failed", error: "未完成，可重试" }]);
});

it("preserves succeeded tasks while converting a running completion to partial failure", () => {
  const first = succeeded("1", "first-download-token");
  const running = { shotId: "2", status: "running" as const, progress: 40, providerJobId: "job-2" };

  const next = productVideoReducer(stateWith([first, running]), { type: "generation_completed", tasks: [first, running] });

  expect(next.phase).toBe("partial_failed");
  expect(next.tasks[0]).toBe(first);
  expect(next.tasks[1]).toEqual({ ...running, status: "failed", error: "未完成，可重试" });
});

it("keeps cancellation distinct and makes only unfinished shots retryable", () => {
  const first = succeeded("1", "first-download-token");
  const failed = { shotId: "2", status: "failed" as const, progress: 0, error: "provider timed out" };
  const running = { shotId: "3", status: "running" as const, progress: 40, providerJobId: "job-3" };
  const queued = { shotId: "4", status: "queued" as const, progress: 0 };

  const next = productVideoReducer(stateWith([first, failed, running, queued]), {
    type: "generation_cancelled",
    tasks: [first, failed, running, queued],
  });

  expect(next.phase).toBe("cancelled");
  expect(next.tasks[0]).toBe(first);
  expect(next.tasks[1]).toBe(failed);
  expect(next.tasks.slice(2)).toEqual([
    { ...running, status: "failed", error: "已取消，可重试" },
    { ...queued, status: "failed", error: "已取消，可重试" },
  ]);
});
