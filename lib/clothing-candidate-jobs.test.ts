// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyDownloadToken, verifyJobToken } from "./download-token";
import { GrsaiError } from "./grsai/errors";
import { submitImageGeneration } from "./grsai/images";
import { submitCandidateBatch } from "./clothing-candidate-jobs";

vi.mock("./grsai/images", () => ({ submitImageGeneration: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = "candidate-secret";
});

afterEach(() => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});

it("submits every candidate independently and keeps opaque running jobs", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "raw-provider-job",
    status: "running",
    progress: 12,
    results: [],
  });

  const tasks = await submitCandidateBatch({
    kind: "model",
    count: 3,
    promptForIndex: (index) => `模特变化 ${index + 1}`,
    aspectRatio: "1090x1443",
    quality: "auto",
    requestUrl: "http://localhost/api/clothing/model-candidates",
  });

  expect(submitImageGeneration).toHaveBeenCalledTimes(3);
  expect(submitImageGeneration).toHaveBeenNthCalledWith(1, {
    images: [],
    prompt: "模特变化 1",
    aspectRatio: "1090x1443",
    quality: "auto",
    timeoutMs: 600_000,
  });
  expect(tasks).toHaveLength(3);
  expect(tasks.every((task) => task.status === "running")).toBe(true);
  expect(tasks[0].providerJobId).not.toContain("raw-provider-job");
  expect(verifyJobToken(tasks[0].providerJobId!, "candidate-secret")).toMatchObject({
    providerJobId: "raw-provider-job",
    render: { imageIndex: 99, annotations: [], watermark: "", applyWatermark: false },
  });
});

it("signs immediate results for clothing preview without exposing the CDN URL", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "done-job",
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/model.png" }],
  });

  const [task] = await submitCandidateBatch({
    kind: "model",
    count: 1,
    promptForIndex: () => "模特",
    aspectRatio: "1090x1443",
    quality: "high",
    requestUrl: "http://localhost/api/clothing/model-candidates",
  });

  expect(task.status).toBe("succeeded");
  expect(task.resultUrl).toMatch(/^http:\/\/localhost\/api\/clothing\/download\?/);
  expect(task.resultUrl).not.toContain("cdn.example");
  expect(verifyDownloadToken(task.downloadToken!, "candidate-secret")).toMatchObject({
    url: "https://cdn.example/model.png",
    render: { imageIndex: 99 },
  });
});

it("preserves successful slots when one provider submission rejects", async () => {
  vi.mocked(submitImageGeneration)
    .mockResolvedValueOnce({ id: "job-1", status: "running", progress: 0, results: [] })
    .mockRejectedValueOnce(new Error("network details"))
    .mockResolvedValueOnce({ id: "job-3", status: "running", progress: 4, results: [] });

  const tasks = await submitCandidateBatch({
    kind: "scene",
    count: 3,
    promptForIndex: (index) => `场景 ${index + 1}`,
    aspectRatio: "1536x1024",
    quality: "medium",
    requestUrl: "http://localhost/api/clothing/scene-candidates",
  });

  expect(tasks.map((task) => task.status)).toEqual(["running", "failed", "running"]);
  expect(tasks[1]).toMatchObject({ error: "参考图生成提交失败，请重试", progress: 0 });
  expect(tasks.map((task) => task.planItemId)).toEqual([
    expect.stringMatching(/^scene-/),
    expect.stringMatching(/^scene-/),
    expect.stringMatching(/^scene-/),
  ]);
});

it("keeps normalized Grsai submission errors visible for retry decisions", async () => {
  vi.mocked(submitImageGeneration).mockRejectedValue(
    new GrsaiError("timeout", "Grsai 请求超时，请重试", 504),
  );

  const [task] = await submitCandidateBatch({
    kind: "model",
    count: 1,
    promptForIndex: () => "模特",
    aspectRatio: "1090x1443",
    quality: "auto",
    requestUrl: "http://localhost/api/clothing/model-candidates",
  });

  expect(task).toMatchObject({
    status: "failed",
    progress: 0,
    error: "Grsai 请求超时，请重试",
  });
});
