import { beforeEach, expect, it, vi } from "vitest";
import { defaultSettings, makePlanItems } from "@/features/product-studio/test-fixtures";
import { buildGenerationPrompt, getImageGenerationResult, submitImageGeneration } from "./images";

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

it.each([
  ["zh-CN", "文案语言必须为 中文。"],
  ["en", "文案语言必须为 英文。"],
  ["ru", "文案语言必须为 俄文。"],
  ["none", "画面中不要生成任何文字。"],
] as const)("uses the centralized %s target-language instruction", (language, instruction) => {
  const prompt = buildGenerationPrompt(makePlanItems(1)[0], {
    ...defaultSettings,
    platform: "general",
    language,
  });

  expect(prompt).toContain("严格保持参考图中的产品结构、颜色、材质细节和 Logo");
  expect(prompt).toContain(instruction);
});

it("keeps image 2 free of AI-generated dimension text for the server overlay", () => {
  const prompt = buildGenerationPrompt(makePlanItems(2)[1], defaultSettings);

  expect(prompt).toContain("第 2 张以第一张参考图中的商品为准，生成完整的 3/4 立体视角商品底图");
  expect(prompt).toContain("整张画布保持纯白");
  expect(prompt).toContain("不得生成文字或尺寸图形");
  expect(prompt).not.toContain("服务器将在右侧叠加尺寸标注");
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

it("passes native 1090x1443 directly to gpt-image-2", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "job-1", status: "running", progress: 0, results: [] }), { status: 200 }),
  );

  await submitImageGeneration(
    { images: [], prompt: "中文提示词", aspectRatio: "1090x1443", quality: "auto" },
    fetchImpl,
  );

  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ aspectRatio: "1090x1443" });
});

it("allows generation submission up to three minutes", async () => {
  const generationSignal = new AbortController().signal;
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(generationSignal);
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "job-1", status: "running" }), { status: 200 }),
  );

  try {
    await submitImageGeneration(
      {
        images: ["data:image/webp;base64,AA=="],
        prompt: "白底主图",
        aspectRatio: "1024x1024",
        quality: "auto",
      },
      fetchImpl,
    );

    expect(timeoutSpy).toHaveBeenCalledWith(180_000);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBe(generationSignal);
  } finally {
    timeoutSpy.mockRestore();
  }
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

it("allows generation status queries up to three minutes", async () => {
  const querySignal = new AbortController().signal;
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(querySignal);
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "job-1", status: "running" }), { status: 200 }),
  );

  try {
    await getImageGenerationResult("job-1", fetchImpl);

    expect(timeoutSpy).toHaveBeenCalledWith(180_000);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBe(querySignal);
  } finally {
    timeoutSpy.mockRestore();
  }
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
