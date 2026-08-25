// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGenerationStatusClient } from "@/features/product-studio/lib/client-api";
import { pollGenerationJob } from "@/features/product-studio/lib/generation-runner";
import { signDownloadUrl } from "@/lib/download-token";
import { GrsaiError } from "@/lib/grsai/errors";
import { getImageGenerationResult } from "@/lib/grsai/images";
import { GET } from "./route";

vi.mock("@/lib/grsai/images", () => ({ getImageGenerationResult: vi.fn() }));
vi.mock("@/lib/download-token", () => ({ signDownloadUrl: vi.fn(() => "signed-token") }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
});

afterEach(() => {
  delete process.env.GRSAI_API_KEY;
  delete process.env.DOWNLOAD_TOKEN_SECRET;
  vi.unstubAllGlobals();
});

it("signs only the first successful result URL", async () => {
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [
      { url: "https://cdn.example/result.png" },
      { url: "https://cdn.example/unplanned.png" },
    ],
  });

  const response = await GET(
    new Request("http://localhost/api/product/jobs/job-1"),
    { params: Promise.resolve({ id: "job-1" }) },
  );

  expect(signDownloadUrl).toHaveBeenCalledTimes(1);
  expect(signDownloadUrl).toHaveBeenCalledWith("https://cdn.example/result.png", "test-secret");
  expect(await response.json()).toEqual({
    task: {
      providerJobId: "job-1",
      status: "succeeded",
      progress: 100,
      resultUrl: "https://cdn.example/result.png",
      downloadToken: "signed-token",
    },
  });
});

it("does not sign running jobs", async () => {
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "job-1",
    status: "running",
    progress: 45,
    results: [],
  });

  const response = await GET(
    new Request("http://localhost/api/product/jobs/job-1"),
    { params: Promise.resolve({ id: "job-1" }) },
  );

  expect(signDownloadUrl).not.toHaveBeenCalled();
  expect(await response.json()).toEqual({
    task: { providerJobId: "job-1", status: "running", progress: 45 },
  });
});

it("returns moderation as a terminal failed task that the client runner preserves", async () => {
  vi.mocked(getImageGenerationResult).mockRejectedValue(
    new GrsaiError("moderation", "图片未通过内容审核", 422),
  );
  const routeRequest = new Request("http://localhost/api/product/jobs/job-1");
  let routeResponse: Response | undefined;
  vi.stubGlobal("fetch", vi.fn(async () => {
    routeResponse = await GET(
      routeRequest,
      { params: Promise.resolve({ id: "job-1" }) },
    );
    return routeResponse;
  }));

  const changes: Array<{ status: string; error?: string }> = [];
  const task = await pollGenerationJob({
    providerJobId: "job-1",
    planItemId: "item-1",
    api: { status: getGenerationStatusClient },
    onTaskChange: (change) => changes.push(change),
  });

  expect(task).toEqual({
    planItemId: "item-1",
    providerJobId: "job-1",
    status: "failed",
    progress: 0,
    error: "图片未通过内容审核",
  });
  expect(changes).toEqual([task]);
  expect(getImageGenerationResult).toHaveBeenCalledOnce();
  expect(routeResponse?.status).toBe(200);
});

it("rejects provider success without a result instead of emitting incomplete UI success", async () => {
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [],
  });

  const response = await GET(
    new Request("http://localhost/api/product/jobs/job-1"),
    { params: Promise.resolve({ id: "job-1" }) },
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "图片生成结果尚不可用，请继续查询" });
  expect(signDownloadUrl).not.toHaveBeenCalled();
});

it("returns 503 when either server secret is missing", async () => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;

  const response = await GET(
    new Request("http://localhost/api/product/jobs/job-1"),
    { params: Promise.resolve({ id: "job-1" }) },
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "图片生成服务尚未配置" });
  expect(getImageGenerationResult).not.toHaveBeenCalled();
});
