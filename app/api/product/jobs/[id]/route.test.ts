// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signDownloadUrl } from "@/lib/download-token";
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
