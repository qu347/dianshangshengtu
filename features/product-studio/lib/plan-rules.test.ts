import { expect, it } from "vitest";
import { analysisWithTwoItems } from "../test-fixtures";
import { applyPlanRules, assertChinesePlanningFields } from "./plan-rules";

it("forces image one to white background and image two to dimensions", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[1].annotations = [
    { label: "Height", displayValue: "wrong" },
    { label: "Capacity", displayValue: "wrong" },
  ];
  const originalAnalysis = structuredClone(analysis);
  const originalFirstItem = structuredClone(analysis.plan[0]);
  const originalSecondItem = structuredClone(analysis.plan[1]);
  const result = applyPlanRules(analysis, [
    { id: "height", sourceLabel: "杯高", displayValue: "4.72 in" },
    { id: "capacity", sourceLabel: "容量", displayValue: "11.83 fl oz" },
  ]);

  expect(result.plan[0]).toMatchObject({ type: "main", copy: "", scene: expect.stringContaining("纯白") });
  expect(result.plan[0].prompt).toContain("纯白背景");
  expect(result.plan[1].annotations).toEqual([
    { label: "Height", displayValue: "4.72 in" },
    { label: "Capacity", displayValue: "11.83 fl oz" },
  ]);
  expect(result.plan[1].prompt).toContain("右侧尺寸标注区");
  expect(analysis).toEqual(originalAnalysis);
  expect(analysis.plan[0]).toEqual(originalFirstItem);
  expect(analysis.plan[1]).toEqual(originalSecondItem);
});

it("leaves AI-planned items after image two unchanged", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  const thirdItem = {
    id: "3",
    type: "detail" as const,
    title: "AI 卖点场景",
    objective: "展示便携使用方式",
    copy: "随时随地携带",
    scene: "通勤桌面",
    prompt: "展示产品在通勤场景中的使用",
    annotations: [],
  };
  analysis.plan.push(thirdItem);

  const result = applyPlanRules(analysis, []);

  expect(result.plan[2]).toEqual(thirdItem);
  expect(result.plan[2]).toBe(analysis.plan[2]);
});

it("rejects non-Chinese editor planning text", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[0].prompt = "Professional product photography";
  expect(() => assertChinesePlanningFields(analysis)).toThrow("规划内容必须使用中文");
});

it("rejects dimension annotations when their count differs from trusted facts", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[1].annotations = [{ label: "Height", displayValue: "wrong" }];
  expect(() => applyPlanRules(analysis, [
    { id: "height", sourceLabel: "杯高", displayValue: "4.72 in" },
    { id: "capacity", sourceLabel: "容量", displayValue: "11.83 fl oz" },
  ])).toThrow("尺寸标注数量必须与产品尺寸数量一致");
});

it("allows a Latin product name inside Chinese planning text", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[0].title = "SKU ABC 白底商品主图";
  expect(assertChinesePlanningFields(analysis)).toBe(analysis);
});
