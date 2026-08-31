// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultModelCandidateRequest } from "@/features/clothing-studio/test-fixtures";
import { submitCandidateBatch } from "@/lib/clothing-candidate-jobs";
import { clothingRequestHeaders } from "@/lib/clothing-upload";
import { POST } from "./route";

vi.mock("@/lib/clothing-candidate-jobs", () => ({ submitCandidateBatch: vi.fn() }));

function post(body: unknown, headers: HeadersInit = clothingRequestHeaders) {
  return new Request("http://localhost/api/clothing/model-candidates", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
  vi.mocked(submitCandidateBatch).mockResolvedValue([]);
});
afterEach(() => {
  delete process.env.GRSAI_API_KEY;
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});
it("rejects missing private header and invalid candidate count", async () => {
  expect((await POST(post(defaultModelCandidateRequest, {}))).status).toBe(403);
  const invalid = await POST(post({ ...defaultModelCandidateRequest, count: 5 }));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ error: "模特生成参数无效" });
  expect(submitCandidateBatch).not.toHaveBeenCalled();
});
it("uses the fixed portrait ratio and model candidate prompts", async () => {
  const response = await POST(post({ ...defaultModelCandidateRequest, count: 2 }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ tasks: [] });
  expect(submitCandidateBatch).toHaveBeenCalledWith(expect.objectContaining({
    kind: "model",
    count: 2,
    aspectRatio: "1090x1443",
    quality: "auto",
    requestUrl: "http://localhost/api/clothing/model-candidates",
    promptForIndex: expect.any(Function),
  }));
  const input = vi.mocked(submitCandidateBatch).mock.calls[0][0];
  expect(input.promptForIndex(0)).toContain("全身照");
});
it("requires both service secrets before submitting", async () => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;
  const response = await POST(post(defaultModelCandidateRequest));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "图片生成服务尚未配置" });
  expect(submitCandidateBatch).not.toHaveBeenCalled();
});
