import { beforeEach, expect, it, vi } from "vitest";
import { analysisWithTwoItems, defaultSettings } from "@/features/product-studio/test-fixtures";
import { analyzeProduct, buildAnalysisPrompt } from "./analysis";

const validInput = {
  images: ["data:image/png;base64,iVBORw0KGgo="],
  settings: defaultSettings,
  productName: "保温杯",
  requirements: "突出便携性",
};

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
  });

  expect(prompt).toContain("恰好 6 个规划项");
  expect(prompt).toContain("不得臆造认证、功效、成分、规格或价格");
  expect(prompt).toContain("confidence 只能是 observed、inferred 或 user_provided");
});

it("submits analysis with the available Grsai vision model", async () => {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisWithTwoItems) } }] }),
      { status: 200 },
    ),
  );

  await analyzeProduct(validInput, fetchImpl);

  const request = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
  expect(request.model).toBe("gemini-3.1-flash-lite");
});

it("conservatively normalizes unsupported provider confidence values", async () => {
  const providerAnalysis = {
    ...analysisWithTwoItems,
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
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisWithTwoItems) } }] }),
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
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisWithTwoItems) } }] }), { status: 200 }),
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
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisWithTwoItems) } }] }), { status: 200 }),
    );

  const result = await analyzeProduct(validInput, fetchImpl);

  expect(result).toEqual(analysisWithTwoItems);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("retains original product context and provenance rules during repair", async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), { status: 200 }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysisWithTwoItems) } }] }), { status: 200 }),
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
});
