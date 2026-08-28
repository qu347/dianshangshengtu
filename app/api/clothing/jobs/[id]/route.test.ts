// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { signJobToken, verifyDownloadToken } from "@/lib/download-token";
import { getImageGenerationResult } from "@/lib/grsai/images";
import type { ImageRenderConfig } from "@/lib/image-render-config";
import { prepareGeneratedImageResult } from "@/lib/product-image-result";
import { GET } from "./route";

vi.mock("@/lib/grsai/images", () => ({ getImageGenerationResult: vi.fn() }));
vi.mock("@/lib/product-image-result", () => ({ prepareGeneratedImageResult: vi.fn() }));

const finalRender: ImageRenderConfig = {
  imageIndex: 2,
  annotations: [],
  watermark: "Brand",
  applyWatermark: true,
};
const candidateRender: ImageRenderConfig = {
  imageIndex: 99,
  annotations: [],
  watermark: "",
  applyWatermark: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
  vi.mocked(prepareGeneratedImageResult).mockImplementation(async ({ render }) => ({ ok: true, render }));
});

afterEach(() => {
  delete process.env.GRSAI_API_KEY;
  delete process.env.DOWNLOAD_TOKEN_SECRET;
  vi.useRealTimers();
});

it("queries the raw provider id and returns a same-origin clothing preview", async () => {
  const token = signJobToken("raw-job", finalRender, "test-secret");
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "raw-job",
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/result.png" }],
  });
  const response = await GET(new Request(`http://localhost/api/clothing/jobs/${token}`), {
    params: Promise.resolve({ id: token }),
  });
  const body = await response.json();
  expect(getImageGenerationResult).toHaveBeenCalledWith("raw-job");
  expect(new URL(body.task.resultUrl).pathname).toBe("/api/clothing/download");
  expect(verifyDownloadToken(body.task.downloadToken, "test-secret").url)
    .toBe("https://cdn.example/result.png");
});

it("uses a two-hour result token for candidate jobs", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-28T00:00:00Z"));
  const now = Math.floor(Date.now() / 1000);
  const token = signJobToken("candidate-job", candidateRender, "test-secret");
  vi.mocked(getImageGenerationResult).mockResolvedValue({
    id: "candidate-job",
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/candidate.png" }],
  });
  const body = await (await GET(new Request(`http://localhost/api/clothing/jobs/${token}`), {
    params: Promise.resolve({ id: token }),
  })).json();
  expect(() => verifyDownloadToken(body.task.downloadToken, "test-secret", now + 7_199)).not.toThrow();
  expect(() => verifyDownloadToken(body.task.downloadToken, "test-secret", now + 7_201)).toThrow();
});

it("rejects a tampered job token before querying Grsai", async () => {
  const response = await GET(new Request("http://localhost/api/clothing/jobs/tampered"), {
    params: Promise.resolve({ id: "tampered" }),
  });
  expect(response.status).toBe(400);
  expect(getImageGenerationResult).not.toHaveBeenCalled();
});

