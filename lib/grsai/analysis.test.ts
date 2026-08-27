import { beforeEach, expect, it, vi } from "vitest";
import { analysisWithTwoItems, defaultSettings } from "@/features/product-studio/test-fixtures";
import type { PlanItem, ProductAnalysis } from "@/features/product-studio/model";
import { analyzeProduct, buildAnalysisPrompt } from "./analysis";

type ProviderPlanItem = Omit<PlanItem, "annotations"> & {
  annotations: Array<{ id: string; label: string }>;
};
type ProviderAnalysisFixture = Omit<ProductAnalysis, "plan"> & { plan: ProviderPlanItem[] };

const validInput = {
  images: ["data:image/png;base64,iVBORw0KGgo="],
  settings: defaultSettings,
  productName: "保温杯",
  requirements: "突出便携性",
  dimensions: [{ id: "height", label: "杯高", value: 12, unit: "cm" as const }],
};

function providerAnalysisWithDimensions() {
  const analysis = structuredClone(analysisWithTwoItems) as unknown as ProviderAnalysisFixture;
  analysis.plan[0].annotations = [];
  analysis.plan[1].annotations = [{ id: "height", label: "杯高" }];
  return analysis;
}

function providerAnalysisWithThreeItems(copy: string) {
  const analysis = providerAnalysisWithDimensions();
  analysis.plan.push({
    id: "3",
    type: "detail",
    title: "使用场景图",
    objective: "展示产品使用方式",
    copy,
    scene: "明亮的居家桌面",
    prompt: "展示产品在居家桌面上的使用场景",
    annotations: [],
  });
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
  expect(prompt).toContain("3/4 立体视角");
  expect(prompt).toContain("纯白背景");
  expect(prompt).toContain("不得生成任何文字、数字、单位、尺寸线、箭头或侧边面板");
  expect(prompt).toContain("返回尺寸 ID “height”及标注标签“杯高”的英文翻译");
  expect(prompt).toContain("AI 不得返回或改写尺寸数值");
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

it("clears later marketing copy in a valid initial response when language is none", async () => {
  const providerAnalysis = providerAnalysisWithThreeItems("立即购买");
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(providerAnalysis) } }],
  }), { status: 200 }));

  const result = await analyzeProduct({
    ...validInput,
    settings: {
      ...defaultSettings,
      platform: "general",
      language: "none",
      imageCount: 3,
    },
  }, fetchImpl);

  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(result.plan.map((item) => item.copy)).toEqual(["", "", ""]);
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

it("clears later marketing copy in a repaired response when language is none", async () => {
  const repairedAnalysis = providerAnalysisWithThreeItems("修复后仍有文案");
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: "not-json" } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(repairedAnalysis) } }],
    }), { status: 200 }));

  const result = await analyzeProduct({
    ...validInput,
    settings: {
      ...defaultSettings,
      platform: "general",
      language: "none",
      imageCount: 3,
    },
  }, fetchImpl);

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result.plan.map((item) => item.copy)).toEqual(["", "", ""]);
});

it("repairs a response with missing message content once", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{}] }), { status: 200 }))
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(providerAnalysisWithDimensions()) } }] }), { status: 200 }),
    );

  const result = await analyzeProduct(validInput, fetchImpl);

  expect(result.plan[1].annotations).toEqual([{ id: "height", label: "杯高", displayValue: "12 cm" }]);
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
  expect(repairRequest.messages[2].content).toContain("height");
  expect(repairRequest.messages[2].content).not.toContain("12 cm");
});

it("repairs non-Chinese planning once and reapplies trusted plan values", async () => {
  const invalidAnalysis = providerAnalysisWithDimensions();
  invalidAnalysis.plan[0].prompt = "White background product photo";
  const repairedAnalysis = providerAnalysisWithDimensions();
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
  expect(result.plan[1].annotations).toEqual([{ id: "height", label: "杯高", displayValue: "12 cm" }]);
});

it("repairs reordered stable dimension ids and binds labels to program-owned values", async () => {
  const input = {
    ...validInput,
    dimensions: [
      { id: "height", label: "杯高", value: 12, unit: "cm" as const },
      { id: "capacity", label: "容量", value: 350, unit: "ml" as const },
    ],
  };
  const reordered = providerAnalysisWithDimensions();
  reordered.plan[1].annotations = [
    { id: "capacity", label: "Capacity" },
    { id: "height", label: "Height" },
  ];
  const repaired = providerAnalysisWithDimensions();
  repaired.plan[1].annotations = [
    { id: "height", label: "Height" },
    { id: "capacity", label: "Capacity" },
  ];
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(reordered) } }],
    }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(repaired) } }],
    }), { status: 200 }));

  const result = await analyzeProduct(input, fetchImpl);

  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(result.plan[1].annotations).toEqual([
    { id: "height", label: "Height", displayValue: "12 cm" },
    { id: "capacity", label: "Capacity", displayValue: "350 mL" },
  ]);
});

it.each([
  ["duplicate", [
    { id: "height", label: "Height" },
    { id: "height", label: "Capacity" },
  ]],
  ["missing", [{ id: "height", label: "Height" }]],
] as const)("rejects %s dimension ids after exactly one repair", async (_label, annotations) => {
  const input = {
    ...validInput,
    dimensions: [
      { id: "height", label: "杯高", value: 12, unit: "cm" as const },
      { id: "capacity", label: "容量", value: 350, unit: "ml" as const },
    ],
  };
  const invalid = providerAnalysisWithDimensions();
  invalid.plan[1].annotations = [...annotations];
  const response = new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(invalid) } }],
  }), { status: 200 });
  const fetchImpl = vi.fn()
    .mockResolvedValueOnce(response)
    .mockResolvedValueOnce(new Response(await response.clone().text(), { status: 200 }));

  await expect(analyzeProduct(input, fetchImpl)).rejects.toMatchObject({
    code: "invalid_request",
    message: "AI 分析结果格式异常，请重新分析",
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
