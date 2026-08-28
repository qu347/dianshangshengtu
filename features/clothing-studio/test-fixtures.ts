import type {
  ClothingAnalysis,
  ClothingGenerationSettings,
  ModelCandidateRequest,
  SceneCandidateRequest,
} from "./model";

export const defaultClothingSettings: ClothingGenerationSettings = {
  platform: "taobao",
  language: "zh-CN",
  aspectRatio: "1090x1443",
  imageCount: 2,
  quality: "auto",
  watermark: "",
};

export const defaultModelCandidateRequest: ModelCandidateRequest = {
  gender: "female",
  ageRange: "26-35",
  appearance: "asian",
  bodyType: "regular",
  hairstyle: "medium",
  requirements: "",
  count: 1,
  quality: "auto",
};

export const defaultSceneCandidateRequest: SceneCandidateRequest = {
  style: "mobile",
  venue: "street",
  lighting: "natural",
  season: "all",
  requirements: "",
  count: 1,
  aspectRatio: "1090x1443",
  quality: "auto",
};

export function makeClothingAnalysis(imageCount = 2): ClothingAnalysis {
  return {
    category: "top",
    productName: "针织上衣",
    visualFacts: [{ value: "米白色针织纹理", confidence: "observed" }],
    audience: ["通勤女性"],
    sellingPoints: [{ title: "细腻针织", evidence: "图片可见纹理", confidence: "observed" }],
    visualDirection: "柔和自然光与简洁构图",
    plan: Array.from({ length: imageCount }, (_, index) => ({
      id: String(index + 1),
      type: index === 0 ? "flat_lay" : "model",
      title: index === 0 ? "白底服装平铺主图" : `模特展示图 ${index + 1}`,
      objective: index === 0 ? "完整展示服装" : "展示穿着版型",
      copy: index === 0 ? "" : "自然穿搭",
      scene: index === 0 ? "纯白背景摄影棚" : "统一自然光场景",
      prompt: index === 0
        ? "纯白背景中平铺服装，不出现人物或道具。"
        : "保持同一模特与同一服装，展示自然穿搭效果。",
    })),
  };
}
