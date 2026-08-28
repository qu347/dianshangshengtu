import { afterEach, expect, it, vi } from "vitest";
import {
  ProductStudioApiError,
  analyzeProductClient,
  getGenerationStatusClient,
  submitGenerationClient,
} from "./client-api";
import { pollGenerationJob, runGenerationBatch } from "./generation-runner";
import { analysisWithTwoItems, defaultSettings, makeImageFile, makePlanItems } from "../test-fixtures";
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

it("waits for image one and passes its signed token only to image two", async () => {
  const [first, second, third] = makePlanItems(3);
  let resolveFirst!: (task: GenerationTask) => void;
  const firstSubmission = new Promise<GenerationTask>((resolve) => { resolveFirst = resolve; });
  const api = {
    submit: vi.fn(({ item }: { item: PlanItem; baseImageToken?: string }) => {
      if (item.id === first.id) return firstSubmission;
      return Promise.resolve({
        planItemId: item.id,
        status: "succeeded" as const,
        progress: 100,
        resultUrl: `https://cdn/${item.id}.png`,
        downloadToken: `token-${item.id}`,
      });
    }),
    status: vi.fn(),
  };

  const batch = runGenerationBatch({
    items: [first, second, third],
    files: [file],
    settings,
    api,
    onTaskChange: vi.fn(),
  });

  await Promise.resolve();
  expect(api.submit).toHaveBeenCalledTimes(1);
  resolveFirst({
    planItemId: first.id,
    status: "succeeded",
    progress: 100,
    resultUrl: "https://cdn/1.png",
    downloadToken: "signed-image-one-token",
  });
  await batch;

  expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({
    item: second,
    baseImageToken: "signed-image-one-token",
  }));
  expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({ item: third }));
  const thirdCall = api.submit.mock.calls.find(([call]) => call.item.id === third.id)?.[0];
  expect(thirdCall).not.toHaveProperty("baseImageToken");
});

it("runs image two independently and without an image-one token when dimensions are disabled", async () => {
  const [first, second] = makePlanItems(2);
  let resolveFirst!: (task: GenerationTask) => void;
  const firstSubmission = new Promise<GenerationTask>((resolve) => { resolveFirst = resolve; });
  const api = {
    submit: vi.fn(({ item }: { item: PlanItem; baseImageToken?: string }) => (
      item.id === first.id
        ? firstSubmission
        : Promise.resolve({
          planItemId: item.id,
          status: "succeeded" as const,
          progress: 100,
          resultUrl: `https://cdn/${item.id}.png`,
          downloadToken: `token-${item.id}`,
        })
    )),
    status: vi.fn(),
  };

  const batch = runGenerationBatch({
    items: [first, { ...second, annotations: [] }],
    files: [file],
    settings: { ...defaultSettings, imageCount: 2, generateDimensionImage: false },
    api,
    onTaskChange: vi.fn(),
  });

  await Promise.resolve();
  expect(api.submit).toHaveBeenCalledTimes(2);
  const secondCall = api.submit.mock.calls.find(([call]) => call.item.id === second.id)?.[0];
  expect(secondCall).not.toHaveProperty("baseImageToken");

  resolveFirst({
    planItemId: first.id,
    status: "failed",
    progress: 0,
    error: "白底生成失败",
  });
  const tasks = await batch;
  expect(tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ planItemId: first.id, status: "failed" }),
    expect.objectContaining({ planItemId: second.id, status: "succeeded" }),
  ]));
});

it("blocks image two when image one fails but still generates later images", async () => {
  const [first, second, third] = makePlanItems(3);
  const changes: GenerationTask[] = [];
  const api = {
    submit: vi.fn(async ({ item }: { item: PlanItem }) => ({
      planItemId: item.id,
      status: item.id === first.id ? "failed" as const : "succeeded" as const,
      progress: item.id === first.id ? 0 : 100,
      ...(item.id === first.id
        ? { error: "白底生成失败" }
        : { resultUrl: `https://cdn/${item.id}.png`, downloadToken: `token-${item.id}` }),
    })),
    status: vi.fn(),
  };

  const tasks = await runGenerationBatch({
    items: [first, second, third],
    files: [file],
    settings,
    api,
    onTaskChange: (task) => changes.push(task),
  });

  expect(api.submit.mock.calls.map(([call]) => call.item.id)).toEqual([first.id, third.id]);
  expect(changes).toContainEqual({
    planItemId: second.id,
    status: "failed",
    progress: 0,
    error: "请先生成或重试白底商品主图",
  });
  expect(tasks).toEqual(expect.arrayContaining([
    expect.objectContaining({ planItemId: second.id, status: "failed" }),
    expect.objectContaining({ planItemId: third.id, status: "succeeded" }),
  ]));
});

it("uses the existing image-one token when retrying image two alone", async () => {
  const second = makePlanItems(2)[1];
  const api = {
    submit: vi.fn(async ({ item }: { item: PlanItem }) => ({
      planItemId: item.id,
      status: "succeeded" as const,
      progress: 100,
      resultUrl: "https://cdn/2.png",
      downloadToken: "token-2",
    })),
    status: vi.fn(),
  };

  await runGenerationBatch({
    items: [second],
    files: [file],
    settings,
    api,
    baseImageToken: "existing-image-one-token",
    onTaskChange: vi.fn(),
  });

  expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({
    item: second,
    baseImageToken: "existing-image-one-token",
  }));
});

it("does not query status when submission returns a signed successful result", async () => {
  const api = {
    submit: vi.fn().mockResolvedValue({
      planItemId: "1",
      providerJobId: "job-1",
      status: "succeeded" as const,
      progress: 100,
      resultUrl: "https://cdn/result.png",
      downloadToken: "signed-token",
    }),
    status: vi.fn().mockRejectedValue(new Error("completed jobs cannot be queried")),
  };

  const tasks = await runGenerationBatch({
    items: [onePlanItem],
    files: [file],
    settings,
    api,
    onTaskChange: vi.fn(),
  });

  expect(api.submit).toHaveBeenCalledTimes(1);
  expect(api.status).not.toHaveBeenCalled();
  expect(tasks[0]).toMatchObject({
    status: "succeeded",
    resultUrl: "https://cdn/result.png",
    downloadToken: "signed-token",
  });
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

it("uses a twenty-minute default timeout when resuming a provider job", async () => {
  const api = {
    status: vi.fn().mockResolvedValue({ planItemId: "1", providerJobId: "job-1", status: "running" as const, progress: 50 }),
  };
  const times = [0, 1_199_999, 1_200_000];
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

it("keeps a submitted provider job resumable when status lookup throws", async () => {
  const api = {
    submit: vi.fn().mockResolvedValue({
      planItemId: "1",
      providerJobId: "job-1",
      status: "running" as const,
      progress: 0,
    }),
    status: vi.fn().mockRejectedValue(new Error("provider lookup details")),
  };
  const changes: GenerationTask[] = [];

  const tasks = await runGenerationBatch({
    items: [onePlanItem],
    files: [file],
    settings,
    api,
    onTaskChange: (task) => changes.push(task),
  });

  expect(api.submit).toHaveBeenCalledOnce();
  expect(tasks).toEqual([{
    planItemId: "1",
    providerJobId: "job-1",
    status: "timed_out",
    progress: 0,
    error: "查询生图任务失败，可继续查询",
  }]);
  expect(changes.at(-1)).toEqual(tasks[0]);
});

it("turns a permanent polling-token error into a failed task instead of a resumable timeout", async () => {
  const changes: GenerationTask[] = [];
  const api = {
    status: vi.fn().mockRejectedValue(
      new ProductStudioApiError("任务编号无效", 400),
    ),
  };

  const task = await pollGenerationJob({
    providerJobId: "expired-token",
    planItemId: "1",
    api,
    onTaskChange: (change) => changes.push(change),
  });

  expect(task).toEqual({
    planItemId: "1",
    providerJobId: "expired-token",
    status: "failed",
    progress: 0,
    error: "任务编号无效",
  });
  expect(changes).toEqual([task]);
});

it("does not start dependent or replacement work after image one is aborted", async () => {
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

  expect(api.submit).toHaveBeenCalledTimes(1);
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
  const opaqueJobToken = "signed.job/token";
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      task: { planItemId: "1", providerJobId: opaqueJobToken, status: "running", progress: 0 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      task: { planItemId: "untrusted", providerJobId: opaqueJobToken, status: "succeeded", progress: 100, resultUrl: "https://cdn/result.png", downloadToken: "token" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);

  const submitted = await submitGenerationClient({
    files: [file],
    settings,
    item: onePlanItem,
    baseImageToken: "signed-image-one-token",
  });
  const checked = await getGenerationStatusClient(opaqueJobToken, "caller-item");

  expect(submitted).toMatchObject({ providerJobId: opaqueJobToken, status: "running" });
  expect(fetchMock.mock.calls[0][0]).toBe("/api/product/generate");
  expect(fetchMock.mock.calls[0][1]?.body).toBeInstanceOf(FormData);
  expect((fetchMock.mock.calls[0][1]?.body as FormData).get("baseImageToken"))
    .toBe("signed-image-one-token");
  expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "X-Product-Studio-Request": "1" });
  expect(fetchMock.mock.calls[1][0]).toBe("/api/product/jobs/signed.job%2Ftoken");
  expect(checked.providerJobId).toBe(opaqueJobToken);
  expect(checked.planItemId).toBe("caller-item");
});

it("analysis client sends the private browser header", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    analysis: analysisWithTwoItems,
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);

  await analyzeProductClient({
    files: [file],
    settings: defaultSettings,
    productName: "保温杯",
    requirements: "白底",
    dimensions: [{ id: "height", label: "杯高", value: 12, unit: "cm" }],
  });

  expect(fetchMock.mock.calls[0][0]).toBe("/api/product/analyze");
  expect(fetchMock.mock.calls[0][1]?.headers).toEqual({ "X-Product-Studio-Request": "1" });
  const body = fetchMock.mock.calls[0][1]?.body as FormData;
  expect(JSON.parse(String(body.get("dimensions")))).toEqual([
    { id: "height", label: "杯高", value: 12, unit: "cm" },
  ]);
});

it("generation clients reject malformed task payloads", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    task: { planItemId: "1", providerJobId: "job-1", status: "unknown", progress: 0 },
  }), { status: 200, headers: { "Content-Type": "application/json" } })));

  await expect(submitGenerationClient({ files: [file], settings, item: onePlanItem })).rejects.toThrow();
});

it("preserves HTTP status and permanence for an invalid polling token", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    error: "任务编号无效",
  }), { status: 400, headers: { "Content-Type": "application/json" } })));

  await expect(getGenerationStatusClient("expired-token", "1")).rejects.toMatchObject({
    name: "ProductStudioApiError",
    message: "任务编号无效",
    status: 400,
    retryable: false,
  });
});

it("rejects an untrusted plan item before client submission", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(submitGenerationClient({
    files: [file],
    settings: { ...defaultSettings, imageCount: 1 },
    item: { ...onePlanItem, id: "01" },
  })).rejects.toThrow("规划项无效");

  expect(fetchMock).not.toHaveBeenCalled();
});
