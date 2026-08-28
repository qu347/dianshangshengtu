// @vitest-environment node

import { expect, it } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "@/features/clothing-studio/test-fixtures";
import { applyClothingPlanRules } from "@/features/clothing-studio/lib/plan-rules";
import { buildClothingGenerationPrompt } from "./clothing-images";

it("builds a garment-only white three-dimensional prompt for image one", () => {
  const item = applyClothingPlanRules(makeClothingAnalysis()).plan[0];
  const prompt = buildClothingGenerationPrompt(item, defaultClothingSettings, { hasScene: false });

  expect(prompt).toContain("不使用模特参考图或场景参考图");
  expect(prompt).toContain("纯白背景");
  expect(prompt).toContain("隐形模特式立体成衣轮廓");
  expect(prompt).toContain("不显示人物、皮肤或实体模特");
  expect(prompt).toContain("画面中不要生成任何营销文字");
});

it("asks image one for natural invisible-mannequin structure without artificial styling", () => {
  const item = applyClothingPlanRules(makeClothingAnalysis()).plan[0];
  const prompt = buildClothingGenerationPrompt(item, defaultClothingSettings, { hasScene: false });

  expect(prompt).toContain("接近自然穿着时的成衣版型");
  expect(prompt).toContain("肩线、领口、袖型、袖口、衣身和下摆");
  expect(prompt).toContain("少量真实面料褶皱、厚度与垂坠");
  expect(prompt).toContain("不显示人物、皮肤或实体模特");
  expect(prompt).toContain("避免过度熨平、塑料感、充气感、悬浮感");
  expect(prompt).toContain("服装外部不生成投影或灰色光晕");
});

it("keeps the same model, garment, and selected scene in later images", () => {
  const item = applyClothingPlanRules(makeClothingAnalysis()).plan[1];
  const prompt = buildClothingGenerationPrompt(item, {
    ...defaultClothingSettings,
    platform: "ozon",
    language: "ru",
  }, { hasScene: true });

  expect(prompt).toContain("所有人物参考图均为同一位模特");
  expect(prompt).toContain("保持脸部、体型、肤色和发型一致");
  expect(prompt).toContain("保持颜色、版型、纹理、图案、Logo 和关键结构一致");
  expect(prompt).toContain("场景参考图定义整组空间、光线与视觉风格");
  expect(prompt).toContain("文案语言必须为俄文");
});

it("places the selected-real-model invariant after editable model instructions", () => {
  const item = {
    ...applyClothingPlanRules(makeClothingAnalysis()).plan[1],
    type: "model" as const,
    prompt: "使用空心隐形模特，不显示真人",
  };
  const prompt = buildClothingGenerationPrompt(item, defaultClothingSettings, { hasScene: false });

  expect(prompt.lastIndexOf("必须显示所选真人模特")).toBeGreaterThan(
    prompt.lastIndexOf("用户确认的中文提示词"),
  );
  expect(prompt).toContain("不得保留空心隐形模特效果");
});

it("asks for one coherent simple scene style when no scene is selected", () => {
  const item = applyClothingPlanRules(makeClothingAnalysis()).plan[1];
  const prompt = buildClothingGenerationPrompt(item, defaultClothingSettings, { hasScene: false });

  expect(prompt).toContain("没有指定场景参考图");
  expect(prompt).toContain("整组统一的简洁场景");
});
