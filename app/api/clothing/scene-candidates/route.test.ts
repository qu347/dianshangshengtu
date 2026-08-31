// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultSceneCandidateRequest } from "@/features/clothing-studio/test-fixtures";
import { submitCandidateBatch } from "@/lib/clothing-candidate-jobs";
import { clothingRequestHeaders } from "@/lib/clothing-upload";
import { POST } from "./route";

vi.mock("@/lib/clothing-candidate-jobs", () => ({ submitCandidateBatch: vi.fn() }));

function post(body: unknown, headers: HeadersInit = clothingRequestHeaders) {
  return new Request("http://localhost/api/clothing/scene-candidates", {
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
it("validates the selected scene ratio and count", async () => {
  const invalid = await POST(post({ ...defaultSceneCandidateRequest, count: 0 }));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toEqual({ error: "场景生成参数无效" });
  expect(submitCandidateBatch).not.toHaveBeenCalled();
});
it("passes the requested final ratio to scene generation", async () => {
  const request = { ...defaultSceneCandidateRequest, count: 3, aspectRatio: "1536x1024" as const };
  const response = await POST(post(request));

  expect(response.status).toBe(200);
  expect(submitCandidateBatch).toHaveBeenCalledWith(expect.objectContaining({
    kind: "scene",
    count: 3,
    aspectRatio: "1536x1024",
    quality: "auto",
    requestUrl: "http://localhost/api/clothing/scene-candidates",
    promptForIndex: expect.any(Function),
  }));
  const input = vi.mocked(submitCandidateBatch).mock.calls[0][0];
  expect(input.promptForIndex(0)).toContain("不出现人物、服装、商品");
});
