import { expect, it } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "@/features/clothing-studio/test-fixtures";
import { createClothingRenderConfig } from "./clothing-render-config";

it("creates annotation-free render settings and applies shared watermark rules", () => {
  const [first, second] = makeClothingAnalysis(2).plan;

  expect(createClothingRenderConfig(first, {
    ...defaultClothingSettings,
    watermark: "店铺名",
  })).toEqual({
    imageIndex: 1,
    annotations: [],
    watermark: "店铺名",
    applyWatermark: true,
    whiteBackgroundMode: "apparel",
  });
  expect(createClothingRenderConfig(first, {
    ...defaultClothingSettings,
    platform: "amazon",
    language: "en",
    watermark: "Brand",
  }).applyWatermark).toBe(false);
  expect(createClothingRenderConfig(second, {
    ...defaultClothingSettings,
    platform: "amazon",
    language: "en",
    watermark: "Brand",
  }).applyWatermark).toBe(true);
});

it("rejects malformed and out-of-range image ids", () => {
  const item = makeClothingAnalysis(2).plan[0];
  expect(() => createClothingRenderConfig({ ...item, id: "01" }, defaultClothingSettings))
    .toThrow("图片序号无效");
  expect(() => createClothingRenderConfig({ ...item, id: "3" }, defaultClothingSettings))
    .toThrow("图片序号无效");
});
