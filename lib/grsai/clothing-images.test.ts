// @vitest-environment node

import { expect, it } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "@/features/clothing-studio/test-fixtures";
import { applyClothingPlanRules } from "@/features/clothing-studio/lib/plan-rules";
import { buildClothingGenerationPrompt } from "./clothing-images";

it("builds a garment-only white flat-lay prompt for image one", () => {
  const item = applyClothingPlanRules(makeClothingAnalysis()).plan[0];
  const prompt = buildClothingGenerationPrompt(item, defaultClothingSettings, { hasScene: false });

  expect(prompt).toContain("不使用模特参考图或场景参考图");
  expect(prompt).toContain("纯白背景");
  expect(prompt).toContain("不出现人物");
  expect(prompt).toContain("画面中不要生成任何营销文字");
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

it("asks for one coherent simple scene style when no scene is selected", () => {
  const item = applyClothingPlanRules(makeClothingAnalysis()).plan[1];
  const prompt = buildClothingGenerationPrompt(item, defaultClothingSettings, { hasScene: false });

  expect(prompt).toContain("没有指定场景参考图");
  expect(prompt).toContain("整组统一的简洁场景");
});
