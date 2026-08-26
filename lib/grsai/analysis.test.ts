import { beforeEach, expect, it, vi } from "vitest";
import { analysisWithTwoItems, defaultSettings } from "@/features/product-studio/test-fixtures";
import { analyzeProduct, buildAnalysisPrompt } from "./analysis";

const validInput = {
  images: ["data:image/png;base64,iVBORw0KGgo="],
  settings: defaultSettings,
  productName: "保温杯",
  requirements: "突出便携性",
  dimensions: [{ id: "height", label: "杯高", value: 12, unit: "cm" as const }],
};

function providerAnalysisWithDimensions() {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[1].annotations = [{ label: "杯高", displayValue: "12 cm" }];
  return analysis;
}

beforeEach(() => {
  process.env.GRSAI_API_KEY = "test-key";
});

it("requires the exact requested plan count and forbids invented claims", () => {
  const prompt = buildAnalysisPrompt({
    productName: "水杯",
    requirements: "",
    imageCount: 6,
    platform: "taobao",
    language: "zh-CN",
    dimensions: [],
  });

  expect(prompt).toContain("恰好 6 个规划项");
  expect(prompt).toContain("不得臆造认证、功效、成分、规格或价格");
  expect(prompt).toContain("confidence 只能是 observed、inferred 或 user_provided");
});

it("requires Chinese planning fields and fixed dimension-image rules", () => {
  const prompt = buildAnalysisPrompt({
    productName: "玻璃杯",
    requirements: "",
    imageCount: 2,
    platform: "amazon",
    language: "en",
    dimensions: [
      { id: "height", sourceLabel: "杯高", displayValue: "4.72 in" },
    ],
  });

  expect(prompt).toContain("所有标题、目标、场景和生图提示词必须使用中文");
  expect(prompt).toContain("第 1 项必须是白底商品主图");
  expect(prompt).toContain("第 2 项必须是尺寸标注图");
  expect(prompt).toContain("将标注标签“杯高”翻译为英文");
  expect(prompt).toContain("数值字符串“4.72 in”必须原样返回");
});

it("submits analysis with the available Grsai vision model", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerAnalysisWithDimensions()) } }] }),
      { status: 200 },
    ),
  );

  await analyzeProduct(validInput, fetchImpl);

  const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(request.model).toBe("gemini-3.1-flash-lite");
});

it("conservatively normalizes unsupported provider confidence values", async () => {
  const providerAnalysis = {
    ...providerAnalysisWithDimensions(),
    visualFacts: [{ value: "银色金属杯身", confidence: "图片可见" }],
    sellingPoints: [{ title: "便携", evidence: "用户提供", confidence: "high" }],
  };
  const responseBody = JSON.stringify({
    choices: [{ message: { content: JSON.stringify(providerAnalysis) } }],
  });
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(responseBody, { status: 200 }))
    .mockResolvedValueOnce(new Response(responseBody, { status: 200 }));

  const result = await analyzeProduct(validInput, fetchImpl);

  expect(result.visualFacts[0].confidence).toBe("inferred");
  expect(result.sellingPoints[0].confidence).toBe("inferred");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
});

it("allows visual analysis up to three minutes", async () => {
  const analysisSignal = new AbortController().signal;
  const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(analysisSignal);
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerAnalysisWithDimensions()) } }] }),
      { status: 200 },
    ),
  );

  try {
    await analyzeProduct(validInput, fetchImpl);

    expect(timeoutSpy).toHaveBeenCalledWith(180_000);
    expect(fetchImpl.mock.calls[0][1]?.signal).toBe(analysisSignal);
  } finally {
    timeoutSpy.mockRestore();
  }
});

it("repairs malformed JSON once and returns a validated analysis", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerAnalysisWithDimensions()) } }] }), { status: 200 }),
    );

  const result = await analyzeProduct(validInput, fetchImpl);

  expect(result.plan).toHaveLength(validInput.settings.imageCount);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("repairs a response with missing message content once", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{}] }), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerAnalysisWithDimensions()) } }] }), { status: 200 }),
    );

  const result = await analyzeProduct(validInput, fetchImpl);

  expect(result.plan[1].annotations).toEqual([{ label: "杯高", displayValue: "12 cm" }]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("retains original product context and provenance rules during repair", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerAnalysisWithDimensions()) } }] }), { status: 200 }),
    );

  await analyzeProduct(validInput, fetchImpl);

  const repairRequest = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body));
  expect(repairRequest.messages[1].content).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: "text", text: expect.stringContaining("产品名称：保温杯") }),
    { type: "image_url", image_url: { url: validInput.images[0] } },
  ]));
  expect(repairRequest.messages[2].content).toContain("原始图像和用户信息仍是唯一事实来源");
  expect(repairRequest.messages[2].content).toContain("inferred");
  expect(repairRequest.messages[2].content).toContain("confidence 只能是 observed、inferred 或 user_provided");
  expect(repairRequest.messages[2].content).toContain("所有标题、目标、场景和生图提示词必须使用中文");
  expect(repairRequest.messages[2].content).toContain("杯高");
  expect(repairRequest.messages[2].content).toContain("12 cm");
});

it("repairs non-Chinese planning once and reapplies trusted plan values", async () => {
  const invalidAnalysis = providerAnalysisWithDimensions();
  invalidAnalysis.plan[0].prompt = "White background product photo";
  invalidAnalysis.plan[1].annotations[0].displayValue = "provider changed this";
  const repairedAnalysis = providerAnalysisWithDimensions();
  repairedAnalysis.plan[1].annotations = [{ label: "杯高", displayValue: "also untrusted" }];
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(invalidAnalysis) } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(repairedAnalysis) } }],
    }), { status: 200 }));

  const result = await analyzeProduct(validInput, fetchImpl);

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result.plan[0]).toMatchObject({ type: "main", copy: "", scene: expect.stringContaining("纯白") });
  expect(result.plan[1].annotations).toEqual([{ label: "杯高", displayValue: "12 cm" }]);
});
