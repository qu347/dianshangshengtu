import { expect, it } from "vitest";
import { analysisWithTwoItems } from "../test-fixtures";
import { defaultSettings } from "../test-fixtures";
import {
  GenerationPlanSchema,
  applyPlanRules,
  assertChinesePlanningFields,
} from "./plan-rules";

const trustedPlan = [
  {
    ...analysisWithTwoItems.plan[0],
    id: "1",
    type: "main" as const,
    copy: "",
    scene: "纯白背景摄影棚，商品居中完整展示",
    prompt: "保持商品完整居中，使用纯白背景，不添加文字。",
    annotations: [],
  },
  {
    ...analysisWithTwoItems.plan[1],
    id: "2",
    type: "detail" as const,
    scene: "纯白背景摄影棚，商品以 3/4 立体视角完整居中展示，四周留出标注空间",
    prompt: "生成完整的 3/4 立体视角商品底图，整张画布使用纯白背景，商品居中且四周留出标注空间；不生成任何文字、数字、单位、尺寸线、箭头或侧边面板。",
    annotations: [{ id: "height", label: "杯高", displayValue: "12 cm" }],
  },
];

it("forces image one to white background and image two to dimensions", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[1].annotations = [
    { id: "height", label: "Height", displayValue: "wrong" },
    { id: "capacity", label: "Capacity", displayValue: "wrong" },
  ];
  const originalAnalysis = structuredClone(analysis);
  const originalFirstItem = structuredClone(analysis.plan[0]);
  const originalSecondItem = structuredClone(analysis.plan[1]);
  const result = applyPlanRules(analysis);

  expect(result.plan[0]).toMatchObject({ type: "main", copy: "", scene: expect.stringContaining("纯白") });
  expect(result.plan[0].prompt).toContain("纯白背景");
  expect(result.plan[1].annotations).toEqual(analysis.plan[1].annotations);
  expect(result.plan[1].prompt).toContain("3/4 立体视角");
  expect(result.plan[1].prompt).toContain("纯白背景");
  expect(result.plan[1].prompt).toContain("四周留出标注空间");
  expect(result.plan[1].prompt).toContain("不生成任何文字、数字、单位、尺寸线、箭头或侧边面板");
  expect(result.plan[1].prompt).not.toContain("左侧约 65%");
  expect(result.plan[1].prompt).not.toContain("右侧约 35%");
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

  const result = applyPlanRules(analysis);

  expect(result.plan[2]).toEqual(thirdItem);
  expect(result.plan[2]).toBe(analysis.plan[2]);
});

it("rejects non-Chinese editor planning text", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[0].prompt = "Professional product photography";
  expect(() => assertChinesePlanningFields(analysis)).toThrow("规划内容必须使用中文");
});

it("does not rewrite trusted dimension annotations by array position", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[1].annotations = [{ id: "height", label: "Height", displayValue: "wrong" }];
  expect(applyPlanRules(analysis).plan[1].annotations).toEqual([
    { id: "height", label: "Height", displayValue: "wrong" },
  ]);
});

it("allows a Latin product name inside Chinese planning text", () => {
  const analysis = structuredClone(analysisWithTwoItems);
  analysis.plan[0].title = "SKU ABC 白底商品主图";
  expect(assertChinesePlanningFields(analysis)).toBe(analysis);
});

it("accepts only a complete trusted fixed-image plan with canonical ids", () => {
  expect(GenerationPlanSchema(defaultSettings).parse(trustedPlan)).toEqual(trustedPlan);
});

it.each([
  ["a malformed id", (plan: typeof trustedPlan) => [{ ...plan[0], id: "01" }, plan[1]]],
  ["an out-of-range id", (plan: typeof trustedPlan) => [plan[0], { ...plan[1], id: "3" }]],
  ["non-Chinese editor text", (plan: typeof trustedPlan) => [{ ...plan[0], title: "Main image" }, plan[1]]],
  ["a non-main first image", (plan: typeof trustedPlan) => [{ ...plan[0], type: "detail" as const }, plan[1]]],
  ["first-image marketing copy", (plan: typeof trustedPlan) => [{ ...plan[0], copy: "立即购买" }, plan[1]]],
  ["a first-image annotation", (plan: typeof trustedPlan) => [{ ...plan[0], annotations: [{ id: "height", label: "杯高", displayValue: "12 cm" }] }, plan[1]]],
  ["a first image without an explicit white background", (plan: typeof trustedPlan) => [{ ...plan[0], prompt: "商品完整居中，背景简洁。" }, plan[1]]],
  ["a non-detail second image", (plan: typeof trustedPlan) => [plan[0], { ...plan[1], type: "main" as const }]],
  ["a second image without the dimension layout", (plan: typeof trustedPlan) => [plan[0], { ...plan[1], prompt: "展示产品尺寸。" }]],
  ["a second image without annotations", (plan: typeof trustedPlan) => [plan[0], { ...plan[1], annotations: [] }]],
] as const)("rejects %s", (_label, mutate) => {
  expect(GenerationPlanSchema(defaultSettings).safeParse(mutate(structuredClone(trustedPlan))).success).toBe(false);
});

it("rejects marketing copy anywhere when the target language is none", () => {
  const settings = {
    ...defaultSettings,
    platform: "general" as const,
    language: "none" as const,
    imageCount: 3,
  };
  const third = {
    ...trustedPlan[1],
    id: "3",
    title: "商品场景图",
    objective: "展示商品使用方式",
    copy: "立即购买",
    scene: "明亮的居家桌面",
    prompt: "展示商品在居家桌面中的使用场景。",
    annotations: [],
  };

  expect(GenerationPlanSchema(settings).safeParse([...trustedPlan, third]).success).toBe(false);
});
