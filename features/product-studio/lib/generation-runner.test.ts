import { afterEach, expect, it, vi } from "vitest";
import { getGenerationStatusClient, submitGenerationClient } from "./client-api";
import { pollGenerationJob, runGenerationBatch } from "./generation-runner";
import { defaultSettings, makeImageFile, makePlanItems } from "../test-fixtures";
import type { GenerationTask, PlanItem } from "../model";

const file = makeImageFile();
const settings = { ...defaultSettings, imageCount: 6 };
const sixPlanItems = makePlanItems(6);
const onePlanItem = makePlanItems(1)[0];

afterEach(() => {
  vi.unstubAllGlobals();
});

it("never runs more than three provider jobs at once", async () => {
  let active = 0;
  let maximum = 0;
  const api = {
    submit: vi.fn(async ({ item }: { item: PlanItem }) => ({
      planItemId: item.id,
      providerJobId: `job-${item.id}`,
      status: "running" as const,
      progress: 0,
    })),
    status: vi.fn(async (jobId: string, planItemId: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return {
        planItemId,
        providerJobId: jobId,
        status: "succeeded" as const,
        progress: 100,
        resultUrl: `https://cdn/${jobId}.png`,
        downloadToken: "token",
      };
    }),
  };

  await runGenerationBatch({
    items: sixPlanItems,
    files: [file],
    settings,
    api,
    onTaskChange: vi.fn(),
    sleep: vi.fn(),
  });

  expect(maximum).toBe(3);
});

it("checks status even when submission reports immediate success", async () => {
  const api = {
    submit: vi.fn().mockResolvedValue({
      planItemId: "1",
      providerJobId: "job-1",
      status: "succeeded" as const,
      progress: 100,
      resultUrl: "https://unsigned/result.png",
    }),
    status: vi.fn().mockResolvedValue({
      planItemId: "1",
      providerJobId: "job-1",
      status: "succeeded" as const,
      progress: 100,
      resultUrl: "https://signed/result.png",
      downloadToken: "signed-token",
    }),
  };

  const tasks = await runGenerationBatch({
    items: [onePlanItem],
    files: [file],
    settings,
    api,
    onTaskChange: vi.fn(),
  });

  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.status).toHaveBeenCalledWith("job-1", "1");
  expect(tasks[0]).toMatchObject({ resultUrl: "https://signed/result.png", downloadToken: "signed-token" });
});

it("polls running jobs with capped exponential delays", async () => {
  const statuses: GenerationTask[] = [
    { planItemId: "1", providerJobId: "job-1", status: "running", progress: 10 },
    { planItemId: "1", providerJobId: "job-1", status: "running", progress: 30 },
    { planItemId: "1", providerJobId: "job-1", status: "running", progress: 60 },
    { planItemId: "1", providerJobId: "job-1", status: "running", progress: 90 },
    { planItemId: "1", providerJobId: "job-1", status: "succeeded", progress: 100, resultUrl: "https://cdn/result.png", downloadToken: "token" },
  ];
  const api = { status: vi.fn(async () => statuses.shift()!) };
  const delays: number[] = [];
  const changes: GenerationTask[] = [];

  const task = await pollGenerationJob({
    providerJobId: "job-1",
    planItemId: "1",
    api,
    onTaskChange: (change) => changes.push(change),
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    now: () => 0,
  });

  expect(delays).toEqual([2000, 4000, 8000, 8000]);
  expect(changes.map((change) => change.progress)).toEqual([10, 30, 60, 90, 100]);
  expect(task.status).toBe("succeeded");
});

it("marks a job timed_out without resubmitting it", async () => {
  const api = {
    submit: vi.fn().mockResolvedValue({ planItemId: "1", providerJobId: "job-1", status: "running" as const, progress: 0 }),
    status: vi.fn().mockResolvedValue({ planItemId: "1", providerJobId: "job-1", status: "running" as const, progress: 50 }),
  };
  const changes: GenerationTask[] = [];

  await runGenerationBatch({
    items: [onePlanItem],
    files: [file],
    settings,
    api,
    onTaskChange: (task) => changes.push(task),
    sleep: vi.fn(),
    timeoutMs: 1,
    now: (() => { let value = 0; return () => value += 2; })(),
  });

  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(changes.at(-1)).toMatchObject({ status: "timed_out", providerJobId: "job-1" });
});

it("uses a ten-minute default timeout when resuming a provider job", async () => {
  const api = {
    status: vi.fn().mockResolvedValue({ planItemId: "1", providerJobId: "job-1", status: "running" as const, progress: 50 }),
  };
  const times = [0, 599_999, 600_000];
  const sleep = vi.fn().mockResolvedValue(undefined);

  const task = await pollGenerationJob({
    providerJobId: "job-1",
    planItemId: "1",
    api,
    onTaskChange: vi.fn(),
    sleep,
    now: () => times.shift()!,
  });

  expect(api.status).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledOnce();
  expect(task).toMatchObject({ status: "timed_out", providerJobId: "job-1" });
});

it("fails only the item whose provider call throws", async () => {
  const [first, second] = makePlanItems(2);
  const api = {
    submit: vi.fn(async ({ item }: { item: PlanItem }) => {
      if (item.id === second.id) throw new Error("provider unavailable");
      return { planItemId: item.id, providerJobId: `job-${item.id}`, status: "running" as const, progress: 0 };
    }),
    status: vi.fn(async (jobId: string, planItemId: string) => ({
      planItemId,
      providerJobId: jobId,
      status: "succeeded" as const,
      progress: 100,
      resultUrl: `https://cdn/${jobId}.png`,
      downloadToken: "token",
    })),
  };
  const changes: GenerationTask[] = [];

  const tasks = await runGenerationBatch({
    items: [first, second],
    files: [file],
    settings,
    api,
    onTaskChange: (task) => changes.push(task),
  });

  expect(tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ planItemId: first.id, status: "succeeded" }),
    expect.objectContaining({ planItemId: second.id, status: "failed", error: "provider unavailable" }),
  ]));
});

it("does not start replacement work after the batch is aborted", async () => {
  const controller = new AbortController();
  const api = {
    submit: vi.fn(async ({ item }: { item: PlanItem }) => ({
      planItemId: item.id,
      providerJobId: `job-${item.id}`,
      status: "running" as const,
      progress: 0,
    })),
    status: vi.fn(async (jobId: string, planItemId: string) => {
      controller.abort();
      return { planItemId, providerJobId: jobId, status: "running" as const, progress: 20 };
    }),
  };

  await runGenerationBatch({
    items: sixPlanItems,
    files: [file],
    settings,
    api,
    onTaskChange: vi.fn(),
    signal: controller.signal,
    sleep: vi.fn(),
  });

  expect(api.submit).toHaveBeenCalledTimes(3);
});

it("does not poll again when aborted during a polling delay", async () => {
  const controller = new AbortController();
  const running: GenerationTask = {
    planItemId: "1",
    providerJobId: "job-1",
    status: "running",
    progress: 20,
  };
  const api = { status: vi.fn().mockResolvedValue(running) };

  const task = await pollGenerationJob({
    providerJobId: "job-1",
    planItemId: "1",
    api,
    onTaskChange: vi.fn(),
    signal: controller.signal,
    sleep: async () => { controller.abort(); },
    now: () => 0,
  });

  expect(api.status).toHaveBeenCalledTimes(1);
  expect(task).toEqual(running);
});

it("rejects an already-aborted standalone poll without calling status", async () => {
  const controller = new AbortController();
  controller.abort();
  const api = { status: vi.fn() };
  const onTaskChange = vi.fn();

  await expect(pollGenerationJob({
    providerJobId: "job-1",
    planItemId: "1",
    api,
    onTaskChange,
    signal: controller.signal,
  })).rejects.toMatchObject({ name: "AbortError" });

  expect(api.status).not.toHaveBeenCalled();
  expect(onTaskChange).not.toHaveBeenCalled();
});

it("does not start status or emit failure when aborted while submission is pending", async () => {
  const controller = new AbortController();
  let resolveSubmission!: (task: GenerationTask) => void;
  const submission = new Promise<GenerationTask>((resolve) => { resolveSubmission = resolve; });
  const api = {
    submit: vi.fn(() => submission),
    status: vi.fn(),
  };
  const changes: GenerationTask[] = [];

  const batch = runGenerationBatch({
    items: [onePlanItem],
    files: [file],
    settings,
    api,
    onTaskChange: (task) => changes.push(task),
    signal: controller.signal,
  });
  controller.abort();
  resolveSubmission({ planItemId: "1", providerJobId: "job-1", status: "running", progress: 0 });

  const results = await batch;

  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.status).not.toHaveBeenCalled();
  expect(changes).not.toContainEqual(expect.objectContaining({ status: "failed" }));
  expect(results).toEqual([]);
});

it("generation clients validate task payloads and attach the caller-owned plan item id", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      task: { planItemId: "1", providerJobId: "job-1", status: "running", progress: 0 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      task: { planItemId: "untrusted", providerJobId: "job-1", status: "succeeded", progress: 100, resultUrl: "https://cdn/result.png", downloadToken: "token" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);

  const submitted = await submitGenerationClient({ files: [file], settings, item: onePlanItem });
  const checked = await getGenerationStatusClient("job/1", "caller-item");

  expect(submitted).toMatchObject({ providerJobId: "job-1", status: "running" });
  expect(fetchMock.mock.calls[0][0]).toBe("/api/product/generate");
  expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  expect(fetchMock.mock.calls[1][0]).toBe("/api/product/jobs/job%2F1");
  expect(checked.planItemId).toBe("caller-item");
});

it("generation clients reject malformed task payloads", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    task: { planItemId: "1", providerJobId: "job-1", status: "unknown", progress: 0 },
  }), { status: 200, headers: { "Content-Type": "application/json" } })));

  await expect(submitGenerationClient({ files: [file], settings, item: onePlanItem })).rejects.toThrow();
});
