import { expect, it } from "vitest";
import { settingsPatchForPlatform, shouldApplyWatermark } from "./platform-rules";

it("maps Ozon to Russian and keeps General manual", () => {
  expect(settingsPatchForPlatform("ozon", "zh-CN")).toEqual({ platform: "ozon", language: "ru" });
  expect(settingsPatchForPlatform("general", "en")).toEqual({ platform: "general", language: "en" });
});

it("omits only the Amazon first-image watermark", () => {
  expect(shouldApplyWatermark("amazon", 1, "Brand")).toBe(false);
  expect(shouldApplyWatermark("amazon", 2, "Brand")).toBe(true);
  expect(shouldApplyWatermark("ozon", 1, "Brand")).toBe(true);
  expect(shouldApplyWatermark("taobao", 1, "")).toBe(false);
});
