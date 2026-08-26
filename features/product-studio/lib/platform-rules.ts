import type { GenerationSettings } from "../model";

const fixedLanguages = {
  taobao: "zh-CN",
  douyin: "zh-CN",
  amazon: "en",
  shopify: "en",
  ozon: "ru",
} as const;

export function fixedPlatformLanguage(platform: GenerationSettings["platform"]) {
  return fixedLanguages[platform as keyof typeof fixedLanguages];
}

export function settingsPatchForPlatform(platform: GenerationSettings["platform"], currentLanguage: GenerationSettings["language"]) {
  return { platform, language: fixedPlatformLanguage(platform) ?? currentLanguage };
}

export function shouldApplyWatermark(platform: GenerationSettings["platform"], imageIndex: number, watermark: string) {
  return Boolean(watermark.trim()) && !(platform === "amazon" && imageIndex === 1);
}
