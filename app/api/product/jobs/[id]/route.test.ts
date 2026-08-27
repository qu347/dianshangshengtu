// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getGenerationStatusClient } from "@/features/product-studio/lib/client-api";
import { pollGenerationJob } from "@/features/product-studio/lib/generation-runner";
import { signJobToken, verifyDownloadToken } from "@/lib/download-token";
import type { ImageRenderConfig } from "@/lib/image-render-config";
import { GrsaiError } from "@/lib/grsai/errors";
import { getImageGenerationResult } from "@/lib/grsai/images";
import { validateGeneratedImage } from "@/lib/product-image-validation";
import { GET } from "./route";

vi.mock("@/lib/grsai/images", () => ({ getImageGenerationResult: vi.fn() }));
vi.mock("@/lib/product-image-validation", () => ({ validateGeneratedImage: vi.fn() }));

const render: ImageRenderConfig = {
  imageIndex: 2,
  annotations: [{ id: "height", label: "Height", displayValue: "4.72 in" }],
  dimensionLayout: {
    bounds: { left: 180, top: 220, right: 820, bottom: 820 },
    placements: [{ id: "height", axis: "vertical", side: "right" }],
  },
  watermark: "Brand",
  applyWatermark: true,
};

function jobToken() {
  return signJobToken("job-1", render, "test-secret");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
  vi.mocked(validateGeneratedImage).mockResolvedValue({ ok: true });
});

afterEach(() => {
  delete process.env.GRSAI_API_KEY;
  delete process.env.DOWNLOAD_TOKEN_SECRET;
  vi.unstubAllGlobals();
});

it("queries the raw provider id internally and signs the rendered result", async () => {
  const token = jobToken();
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
    new Request(`http://localhost/api/product/jobs/${token}`),
    { params: Promise.resolve({ id: token }) },
  );
  const body = await response.json();

  expect(getImageGenerationResult).toHaveBeenCalledWith("job-1");
  expect(body.task).toMatchObject({
    providerJobId: token,
    status: "succeeded",
    progress: 100,
  });
  const resultUrl = new URL(body.task.resultUrl);
  expect(resultUrl.origin).toBe("http://localhost");
  expect(resultUrl.pathname).toBe("/api/product/download");
  expect(resultUrl.searchParams.get("inline")).toBe("1");
  expect(resultUrl.searchParams.get("token")).toBe(body.task.downloadToken);
  expect(verifyDownloadToken(body.task.downloadToken, "test-secret")).toEqual({
    url: "https://cdn.example/result.png",
    render,
  });
});

it("preserves the same opaque job token while the provider is still running", async () => {
  const token = jobToken();
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "job-1",
    status: "running",
    progress: 45,
    results: [],
  });

  const response = await GET(
    new Request(`http://localhost/api/product/jobs/${token}`),
    { params: Promise.resolve({ id: token }) },
  );

  expect(getImageGenerationResult).toHaveBeenCalledWith("job-1");
  expect(await response.json()).toEqual({
    task: { providerJobId: token, status: "running", progress: 45 },
  });
});

it("unwraps and queries a default job token after the twenty-minute polling window", async () => {
  const issuedAt = Math.floor(Date.now() / 1_000) - 21 * 60;
  const token = signJobToken("job-1", render, "test-secret", issuedAt);
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "job-1",
    status: "running",
    progress: 80,
    results: [],
  });

  const response = await GET(
    new Request(`http://localhost/api/product/jobs/${token}`),
    { params: Promise.resolve({ id: token }) },
  );

  expect(response.status).toBe(200);
  expect(getImageGenerationResult).toHaveBeenCalledWith("job-1");
  expect(await response.json()).toEqual({
    task: { providerJobId: token, status: "running", progress: 80 },
  });
});

it("returns moderation as a terminal failed task that the client runner preserves", async () => {
  const token = jobToken();
  vi.mocked(getImageGenerationResult).mockRejectedValue(
    new GrsaiError("moderation", "图片未通过内容审核", 422),
  );
  const routeRequest = new Request(`http://localhost/api/product/jobs/${token}`);
  let routeResponse: Response | undefined;
  vi.stubGlobal("fetch", vi.fn(async () => {
    routeResponse = await GET(
      routeRequest,
      { params: Promise.resolve({ id: token }) },
    );
    return routeResponse;
  }));

  const changes: Array<{ status: string; error?: string }> = [];
  const task = await pollGenerationJob({
    providerJobId: token,
    planItemId: "item-1",
    api: { status: getGenerationStatusClient },
    onTaskChange: (change) => changes.push(change),
  });

  expect(task).toEqual({
    planItemId: "item-1",
    providerJobId: token,
    status: "failed",
    progress: 0,
    error: "图片未通过内容审核",
  });
  expect(changes).toEqual([task]);
  expect(getImageGenerationResult).toHaveBeenCalledOnce();
  expect(routeResponse?.status).toBe(200);
});

it("rejects provider success without a result instead of emitting incomplete UI success", async () => {
  const token = jobToken();
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [],
  });

  const response = await GET(
    new Request(`http://localhost/api/product/jobs/${token}`),
    { params: Promise.resolve({ id: token }) },
  );

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "图片生成结果尚不可用，请继续查询" });
});

it("turns a non-white polled image-one result into a retryable failed task", async () => {
  const imageOneRender: ImageRenderConfig = {
    imageIndex: 1,
    annotations: [],
    watermark: "",
    applyWatermark: false,
  };
  const token = signJobToken("job-1", imageOneRender, "test-secret");
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/non-white.png" }],
  });
  vi.mocked(validateGeneratedImage).mockResolvedValue({
    ok: false,
    error: "白底商品主图不是纯白背景，请重试此图",
  });

  const response = await GET(
    new Request(`http://localhost/api/product/jobs/${token}`),
    { params: Promise.resolve({ id: token }) },
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    task: {
      providerJobId: token,
      status: "failed",
      progress: 100,
      error: "白底商品主图不是纯白背景，请重试此图",
    },
  });
  expect(validateGeneratedImage).toHaveBeenCalledWith("https://cdn.example/non-white.png", 1);
});

it("returns 503 when either server secret is missing", async () => {
  const token = jobToken();
  delete process.env.DOWNLOAD_TOKEN_SECRET;

  const response = await GET(
    new Request(`http://localhost/api/product/jobs/${token}`),
    { params: Promise.resolve({ id: token }) },
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "图片生成服务尚未配置" });
  expect(getImageGenerationResult).not.toHaveBeenCalled();
});

it("rejects an invalid job token before querying the provider", async () => {
  const response = await GET(
    new Request("http://localhost/api/product/jobs/not-a-token"),
    { params: Promise.resolve({ id: "not-a-token" }) },
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "任务编号无效" });
  expect(getImageGenerationResult).not.toHaveBeenCalled();
});
