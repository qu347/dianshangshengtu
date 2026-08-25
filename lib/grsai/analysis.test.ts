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
