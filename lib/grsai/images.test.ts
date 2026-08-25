import { beforeEach, expect, it, vi } from "vitest";
import { defaultSettings, makePlanItems } from "@/features/product-studio/test-fixtures";
import { buildGenerationPrompt, getImageGenerationResult, submitImageGeneration } from "./images";

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

it("adds product fidelity and text constraints to the confirmed plan", () => {
  const prompt = buildGenerationPrompt(makePlanItems(1)[0], { ...defaultSettings, language: "none" });

  expect(prompt).toContain("严格保持参考图中的产品结构、颜色、材质细节和 Logo");
  expect(prompt).toContain("画面中不要生成任何文字");
});

it("submits gpt-image-2 with reference images and JSON reply mode", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "job-1", status: "running" }), { status: 200 }),
  );

  const job = await submitImageGeneration(
    {
      images: ["data:image/webp;base64,AA=="],
      prompt: "白底主图",
      aspectRatio: "1024x1024",
      quality: "auto",
    },
    fetchImpl,
  );
  const request = JSON.parse(fetchImpl.mock.calls[0][1].body);

  expect(request).toMatchObject({
    model: "gpt-image-2",
    prompt: "白底主图",
    images: ["data:image/webp;base64,AA=="],
    aspectRatio: "1024x1024",
    quality: "auto",
    replyType: "json",
  });
  expect(job).toEqual({ id: "job-1", status: "running", progress: 0, results: [] });
});

it("preserves the provider job id when immediate success has no usable result", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ id: "job-1", status: "succeeded", results: [] }),
      { status: 200 },
    ),
  );

  await expect(submitImageGeneration(
    {
      images: ["data:image/webp;base64,AA=="],
      prompt: "白底主图",
      aspectRatio: "1024x1024",
      quality: "auto",
    },
    fetchImpl,
  )).resolves.toEqual({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [],
  });
});

it("normalizes a successful result query", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "job-1",
        status: "succeeded",
        results: [{ url: "https://cdn.example/result.png" }],
      }),
      { status: 200 },
    ),
  );

  expect(await getImageGenerationResult("job-1", fetchImpl)).toMatchObject({
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/result.png" }],
  });
});

it.each([
  ["has no result", []],
  ["has a malformed result URL", [{ url: "not a url" }]],
  ["has a non-HTTPS result URL", [{ url: "http://cdn.example/result.png" }]],
])("rejects provider success that %s as a safe resumable upstream error", async (_label, results) => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "job-1", status: "succeeded", results }), { status: 200 }),
  );

  await expect(getImageGenerationResult("job-1", fetchImpl)).rejects.toMatchObject({
    code: "upstream",
    message: "图片生成结果尚不可用，请继续查询",
  });
});

it("maps provider moderation failure to a safe error", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: "job-1",
        status: "failed",
        failure_reason: "input_moderation",
        error: "raw provider detail",
      }),
      { status: 200 },
    ),
  );

  await expect(getImageGenerationResult("job-1", fetchImpl)).rejects.toMatchObject({
    code: "moderation",
    message: "图片未通过内容审核",
  });
});
