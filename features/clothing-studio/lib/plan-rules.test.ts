import type { ClothingAnalysis, ClothingGenerationSettings } from "../model";
import { applyClothingPlanRules, ClothingGenerationPlanSchema } from "./plan-rules";

const settings: ClothingGenerationSettings = {
  platform: "taobao",
  language: "zh-CN",
  aspectRatio: "1090x1443",
  imageCount: 3,
  quality: "auto",
  watermark: "",
};

function analysis(): ClothingAnalysis {
  return {
    category: "top",
    productName: "针织上衣",
    visualFacts: [{ value: "米白色针织纹理", confidence: "observed" }],
    audience: ["通勤女性"],
    sellingPoints: [{ title: "细腻针织", evidence: "图片可见纹理", confidence: "observed" }],
    visualDirection: "柔和自然光与简洁构图",
    plan: [1, 2, 3].map((id) => ({
      id: String(id),
      type: id === 1 ? "model" as const : "detail" as const,
      title: `第${id}张服装图`,
      objective: "展示服装版型和细节",
      copy: "舒适日常",
      scene: "简洁自然光场景",
      prompt: "保持服装颜色版型并清晰展示",
    })),
  };
}

it("forces image one to be the canonical white flat lay", () => {
  const ruled = applyClothingPlanRules(analysis());

  expect(ruled.plan[0]).toMatchObject({
    id: "1",
    type: "flat_lay",
    title: "白底服装平铺主图",
    copy: "",
  });
  expect(ruled.plan[0].prompt).toContain("纯白背景");
  expect(ruled.plan[0].prompt).toContain("不出现人物");
  expect(ruled.plan[1].type).toBe("detail");
});

it("accepts a consecutive Chinese plan whose length matches settings", () => {
  const ruled = applyClothingPlanRules(analysis());
  expect(ClothingGenerationPlanSchema(settings).parse(ruled.plan)).toHaveLength(3);
});

it("rejects later flat lays, non-Chinese planning fields, and nonconsecutive IDs", () => {
  const ruled = applyClothingPlanRules(analysis());
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, type: "flat_lay" } : item),
  )).toThrow("仅第 1 张可以是白底平铺图");
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, prompt: "English only" } : item),
  )).toThrow("规划内容必须使用中文");
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, id: "3" } : item),
  )).toThrow("规划序号必须从 1 连续排列");
});

it("removes visible copy when language is none", () => {
  const noCopySettings = { ...settings, platform: "general" as const, language: "none" as const };
  const ruled = applyClothingPlanRules(analysis(), noCopySettings.language);
  expect(ruled.plan.every((item) => item.copy === "")).toBe(true);
  expect(ClothingGenerationPlanSchema(noCopySettings).parse(ruled.plan)).toHaveLength(3);
});
