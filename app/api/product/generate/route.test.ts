// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultSettings, makePlanItems } from "@/features/product-studio/test-fixtures";
import { buildGenerationPrompt, submitImageGeneration } from "@/lib/grsai/images";
import { POST } from "./route";

vi.mock("@/lib/grsai/images", () => ({
  buildGenerationPrompt: vi.fn(() => "final prompt"),
  submitImageGeneration: vi.fn(),
}));

function generationForm(imageCount: number) {
  const form = new FormData();
  for (let index = 0; index < imageCount; index += 1) {
    form.append("images", new File(["x"], `${index}.webp`, { type: "image/webp" }));
  }
  form.append("settings", JSON.stringify(defaultSettings));
  form.append("item", JSON.stringify(makePlanItems(1)[0]));
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.GRSAI_API_KEY;
});

it("rejects zero and more than six normalized images", async () => {
  expect((await POST(new Request("http://localhost/api/product/generate", {
    method: "POST",
    body: generationForm(0),
  }))).status).toBe(400);
  expect((await POST(new Request("http://localhost/api/product/generate", {
    method: "POST",
    body: generationForm(7),
  }))).status).toBe(400);
});

it("returns a normalized task with the caller plan item id", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "job-1",
    status: "running",
    progress: 0,
    results: [],
  });

  const response = await POST(new Request("http://localhost/api/product/generate", {
    method: "POST",
    body: generationForm(1),
  }));

  expect(buildGenerationPrompt).toHaveBeenCalledWith(makePlanItems(1)[0], defaultSettings);
  expect(submitImageGeneration).toHaveBeenCalledWith({
    images: ["data:image/webp;base64,eA=="],
    prompt: "final prompt",
    aspectRatio: "1024x1536",
    quality: "auto",
  });
  expect(await response.json()).toEqual({
    task: {
      planItemId: "1",
      providerJobId: "job-1",
      status: "running",
      progress: 0,
    },
  });
});

it("returns 503 without calling the provider when the API key is absent", async () => {
  delete process.env.GRSAI_API_KEY;

  const response = await POST(new Request("http://localhost/api/product/generate", {
    method: "POST",
    body: generationForm(1),
  }));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "图片生成服务尚未配置" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("rejects an oversized declared body before parsing multipart data", async () => {
  const request = new Request("http://localhost/api/product/generate", {
    method: "POST",
    body: generationForm(1),
    headers: { "Content-Length": String(36 * 1024 * 1024 + 1) },
  });
  const formDataSpy = vi.spyOn(request, "formData");

  const response = await POST(request);

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "请求体不能超过 36 MB" });
  expect(formDataSpy).not.toHaveBeenCalled();
  expect(submitImageGeneration).not.toHaveBeenCalled();
});
