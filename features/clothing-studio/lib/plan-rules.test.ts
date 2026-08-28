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

it("forces image one to be the canonical three-dimensional white product image", () => {
  const ruled = applyClothingPlanRules(analysis());

  expect(ruled.plan[0]).toMatchObject({
    id: "1",
    type: "product",
    title: "白底立体服装主图",
    copy: "",
  });
  expect(ruled.plan[0].prompt).toContain("纯白背景");
  expect(ruled.plan[0].prompt).toContain("不显示人物、皮肤、实体模特");
  expect(ruled.plan[0].prompt).toContain("接近自然穿着时的成衣版型");
  expect(ruled.plan[0].prompt).toContain("隐形模特式立体成衣轮廓");
  expect(ruled.plan[0].prompt).toContain("少量真实褶皱与面料垂坠");
  expect(ruled.plan[0].prompt).toContain("避免塑料感、悬浮感和过度平整");
  expect(ruled.plan[1].type).toBe("detail");
});

it("accepts a consecutive Chinese plan whose length matches settings", () => {
  const ruled = applyClothingPlanRules(analysis());
  expect(ClothingGenerationPlanSchema(settings).parse(ruled.plan)).toHaveLength(3);
});

it("rejects later product images, non-Chinese planning fields, and nonconsecutive IDs", () => {
  const ruled = applyClothingPlanRules(analysis());
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, type: "product" } : item),
  )).toThrow("仅第 1 张可以是白底立体主图");
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, prompt: "English only" } : item),
  )).toThrow("规划内容必须使用中文");
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, id: "3" } : item),
  )).toThrow("规划序号必须从 1 连续排列");
});

it("normalizes legacy later flat-lay types before enforcing the image-one-only rule", () => {
  const ruled = applyClothingPlanRules(analysis());
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, type: "flat_lay" } : item),
  )).toThrow("仅第 1 张可以是白底立体主图");
});

it("rejects model prompts that directly request a hollow mannequin instead of the selected model", () => {
  const ruled = applyClothingPlanRules(analysis());
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? {
      ...item,
      type: "model",
      prompt: "使用空心隐形模特，不显示真人",
    } : item),
  )).toThrow("模特图必须显示所选真人模特");
});

it.each([
  "不要显示其他人物，仅显示所选真人模特",
  "保持隐形模特主图中的服装细节，由所选真人模特穿着",
  "使用隐形模特主图中的服装细节，由所选真人模特穿着",
  "不要显示所选模特以外的其他人物",
])("accepts valid model instructions that mention people or the invisible-mannequin source", (prompt) => {
  const ruled = applyClothingPlanRules(analysis());
  expect(() => ClothingGenerationPlanSchema(settings).parse(
    ruled.plan.map((item, index) => index === 1 ? { ...item, type: "model", prompt } : item),
  )).not.toThrow();
});

it("removes visible copy when language is none", () => {
  const noCopySettings = { ...settings, platform: "general" as const, language: "none" as const };
  const ruled = applyClothingPlanRules(analysis(), noCopySettings.language);
  expect(ruled.plan.every((item) => item.copy === "")).toBe(true);
  expect(ClothingGenerationPlanSchema(noCopySettings).parse(ruled.plan)).toHaveLength(3);
});
