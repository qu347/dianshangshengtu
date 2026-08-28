// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeClothingAnalysis, defaultClothingSettings } from "@/features/clothing-studio/test-fixtures";
import { analyzeClothing, buildClothingAnalysisPrompt } from "./clothing-analysis";

function chatResponse(content: string) {
  return Response.json({ choices: [{ message: { content } }] });
}

function validProviderAnalysis(count = 2) {
  const analysis = makeClothingAnalysis(count);
  return {
    ...analysis,
    plan: analysis.plan.map((item, index) => ({
      ...item,
      type: index === 0 ? "model" : item.type,
      title: index === 0 ? "普通首图" : item.title,
      copy: index === 0 ? "不应保留" : item.copy,
      scene: index === 0 ? "普通场景" : item.scene,
      prompt: index === 0 ? "普通服装展示提示词" : item.prompt,
    })),
  };
}

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.GRSAI_API_KEY;
});

it("labels garment, model, and optional scene references in the multimodal request", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => chatResponse(JSON.stringify(validProviderAnalysis())));

  const result = await analyzeClothing({
    garments: ["data:image/webp;base64,Z2FybWVudA=="],
    model: "data:image/webp;base64,bW9kZWw=",
    scene: "data:image/webp;base64,c2NlbmU=",
    settings: defaultClothingSettings,
    requirements: "突出垂坠感",
  }, fetchImpl);

  expect(result.plan[0]).toMatchObject({ type: "product", title: "白底立体服装主图", copy: "" });
  const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  const requestText = JSON.stringify(request);
  expect(requestText).toContain("以下图片为服装参考图");
  expect(requestText).toContain("以下图片为整组唯一模特参考图");
  expect(requestText).toContain("以下图片为可选场景风格参考图");
  expect(requestText).toContain("突出垂坠感");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("omits the scene reference group when no scene is selected", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => chatResponse(JSON.stringify(validProviderAnalysis())));

  await analyzeClothing({
    garments: ["data:image/webp;base64,Z2FybWVudA=="],
    model: "data:image/webp;base64,bW9kZWw=",
    settings: defaultClothingSettings,
    requirements: "",
  }, fetchImpl);

  const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(JSON.stringify(request)).not.toContain("以下图片为可选场景风格参考图");
});

it("repairs one invalid JSON response and never makes a third request", async () => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(chatResponse("not-json"))
    .mockResolvedValueOnce(chatResponse(JSON.stringify(validProviderAnalysis())));

  const result = await analyzeClothing({
    garments: ["data:image/webp;base64,Z2FybWVudA=="],
    model: "data:image/webp;base64,bW9kZWw=",
    settings: defaultClothingSettings,
    requirements: "",
  }, fetchImpl);

  expect(result.plan).toHaveLength(2);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  const repairRequest = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
  expect(JSON.stringify(repairRequest.messages)).not.toContain("image_url");
  expect(JSON.stringify(repairRequest.messages)).toContain("not-json");
});

it.each([400, 502])("falls back to the stable vision model after upstream HTTP %s", async (status) => {
  const fetchImpl = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("upstream error", { status }))
    .mockResolvedValueOnce(chatResponse(JSON.stringify(validProviderAnalysis())));

  const result = await analyzeClothing({
    garments: ["data:image/webp;base64,Z2FybWVudA=="],
    model: "data:image/webp;base64,bW9kZWw=",
    settings: defaultClothingSettings,
    requirements: "",
  }, fetchImpl);

  expect(result.plan).toHaveLength(2);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)).model).toBe("gemini-3.1-flash-lite");
  expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body)).model).toBe("gemini-2.5-flash");
});

it("normalizes recoverable AI formatting differences before strict business validation", async () => {
  const provider = validProviderAnalysis();
  const recoverable = {
    ...provider,
    category: "上衣",
    extraExplanation: "应忽略",
    visualFacts: provider.visualFacts.map((item) => ({ ...item, source: "image" })),
    sellingPoints: provider.sellingPoints.map((item) => ({ ...item, rank: 1 })),
    plan: provider.plan.map((item, index) => ({
      ...item,
      id: index + 1,
      type: index === 0 ? "flat_lay" : "on_model",
      copy: index === 0 ? null : item.copy,
      extraCameraNote: "应忽略",
    })),
  };
  const wrapped = `分析完成：\n\`\`\`json\n${JSON.stringify(recoverable)}\n\`\`\`\n以上为规划。`;
  const fetchImpl = vi.fn<typeof fetch>(async () => chatResponse(wrapped));

  const result = await analyzeClothing({
    garments: ["data:image/webp;base64,Z2FybWVudA=="],
    model: "data:image/webp;base64,bW9kZWw=",
    settings: defaultClothingSettings,
    requirements: "",
  }, fetchImpl);

  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(result.category).toBe("top");
  expect(result.plan).toMatchObject([
    { id: "1", type: "product", copy: "" },
    { id: "2", type: "model" },
  ]);
});

it("returns a retryable format error after two invalid responses", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => chatResponse("still-not-json"));

  await expect(analyzeClothing({
    garments: ["data:image/webp;base64,Z2FybWVudA=="],
    model: "data:image/webp;base64,bW9kZWw=",
    settings: defaultClothingSettings,
    requirements: "",
  }, fetchImpl)).rejects.toThrow("AI 服装分析结果格式异常，请重新分析");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("requests an exact Chinese plan and supported clothing categories", () => {
  const prompt = buildClothingAnalysisPrompt({
    settings: { ...defaultClothingSettings, imageCount: 4 },
    requirements: "突出面料",
    hasScene: false,
  });

  expect(prompt).toContain("恰好 4 个规划项");
  expect(prompt).toContain("top、bottom、dress、coat、set");
  expect(prompt).toContain("标题、画面目标、场景和生图提示词必须使用中文");
  expect(prompt).toContain("plan.type 只能是 product、model、scene、detail");
  expect(prompt).toContain("第 1 项必须是纯白背景的立体服装主图");
  expect(prompt).toContain("隐形模特式立体成衣轮廓");
  expect(prompt).toContain("不显示人物、皮肤或实体模特");
  expect(prompt).toContain("统一风格的简洁场景");
});
