import { z } from "zod";

const fixedLanguages = {
  taobao: "zh-CN",
  douyin: "zh-CN",
  amazon: "en",
  shopify: "en",
  ozon: "ru",
} as const;

export const ClothingGenerationSettingsSchema = z.object({
  platform: z.enum(["general", "taobao", "douyin", "amazon", "shopify", "ozon"]),
  language: z.enum(["none", "zh-CN", "en", "ru"]),
  aspectRatio: z.enum(["1024x1024", "1024x1536", "1536x1024", "1090x1443"]),
  imageCount: z.number().int().min(1).max(16),
  quality: z.enum(["auto", "low", "medium", "high"]),
  watermark: z.string().max(40),
}).superRefine((settings, context) => {
  const expected = fixedLanguages[settings.platform as keyof typeof fixedLanguages];
  if (expected && settings.language !== expected) {
    context.addIssue({
      code: "custom",
      path: ["language"],
      message: "平台语言必须使用固定映射",
    });
  }
});
export type ClothingGenerationSettings = z.infer<typeof ClothingGenerationSettingsSchema>;

export const ClothingCategorySchema = z.enum(["top", "bottom", "dress", "coat", "set"]);
export type ClothingCategory = z.infer<typeof ClothingCategorySchema>;

const CandidateQualitySchema = z.enum(["auto", "low", "medium", "high"]);
const RequirementsSchema = z.string().trim().max(1000);

export const ModelCandidateRequestSchema = z.object({
  gender: z.enum(["female", "male"]),
  ageRange: z.enum(["18-25", "26-35", "36-45", "46-plus"]),
  appearance: z.enum(["asian", "white", "black", "latino", "middle-eastern", "custom"]),
  bodyType: z.enum(["slim", "regular", "curvy", "athletic", "plus-size"]),
  hairstyle: z.enum(["short", "medium", "long", "tied", "custom"]),
  requirements: RequirementsSchema,
  count: z.number().int().min(1).max(4),
  quality: CandidateQualitySchema,
}).strict();
export type ModelCandidateRequest = z.infer<typeof ModelCandidateRequestSchema>;

export const SceneCandidateRequestSchema = z.object({
  style: z.enum(["mobile", "editorial", "minimal", "luxury", "lifestyle", "custom"]),
  venue: z.enum(["studio", "indoor", "outdoor", "street", "home", "custom"]),
  lighting: z.enum(["natural", "soft-studio", "sunny", "moody", "custom"]),
  season: z.enum(["all", "spring", "summer", "autumn", "winter"]),
  requirements: RequirementsSchema,
  count: z.number().int().min(1).max(4),
  aspectRatio: z.enum(["1024x1024", "1024x1536", "1536x1024", "1090x1443"]),
  quality: CandidateQualitySchema,
}).strict();
export type SceneCandidateRequest = z.infer<typeof SceneCandidateRequestSchema>;

export type ReferenceAsset = {
  id: string;
  kind: "model" | "scene";
  source: "upload" | "generated";
  previewUrl: string;
  file?: File;
  downloadToken?: string;
};

export function validateReferenceAsset(asset: ReferenceAsset) {
  const hasFile = asset.file instanceof File;
  const hasToken = typeof asset.downloadToken === "string" && asset.downloadToken.length > 0;
  const valid = asset.id.trim().length > 0
    && asset.previewUrl.trim().length > 0
    && ((asset.source === "upload" && hasFile && !hasToken)
      || (asset.source === "generated" && hasToken && !hasFile));
  if (!valid) throw new Error("参考图来源无效");
  return asset;
}

const ConfidenceSchema = z.enum(["observed", "inferred", "user_provided"]);

const CanonicalClothingPlanItemSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["product", "model", "scene", "detail"]),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  copy: z.string(),
  scene: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
}).strict();

export const ClothingPlanItemSchema = z.preprocess((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const item = value as Record<string, unknown>;
  return item.type === "flat_lay" ? { ...item, type: "product" } : value;
}, CanonicalClothingPlanItemSchema);
export type ClothingPlanItem = z.infer<typeof ClothingPlanItemSchema>;

export const ClothingAnalysisSchema = z.object({
  category: ClothingCategorySchema,
  productName: z.string().trim().min(1),
  visualFacts: z.array(z.object({
    value: z.string().trim().min(1),
    confidence: ConfidenceSchema,
  }).strict()),
  audience: z.array(z.string().trim().min(1)),
  sellingPoints: z.array(z.object({
    title: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    confidence: ConfidenceSchema,
  }).strict()),
  visualDirection: z.string().trim().min(1),
  plan: z.array(ClothingPlanItemSchema).min(1).max(16),
}).strict();
export type ClothingAnalysis = z.infer<typeof ClothingAnalysisSchema>;

export const ClothingGenerationTaskSchema = z.object({
  planItemId: z.string().min(1),
  providerJobId: z.string().min(1).optional(),
  status: z.enum(["queued", "submitting", "running", "succeeded", "failed", "timed_out"]),
  progress: z.number().min(0).max(100),
  resultUrl: z.string().url().optional(),
  downloadToken: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
}).superRefine((task, context) => {
  if (task.status === "succeeded" && (!task.resultUrl || !task.downloadToken)) {
    context.addIssue({ code: "custom", message: "成功任务必须包含结果地址和下载令牌" });
  }
  if (task.status === "failed" && !task.error) {
    context.addIssue({ code: "custom", message: "失败任务必须包含错误说明" });
  }
  if (task.status === "timed_out" && !task.providerJobId) {
    context.addIssue({ code: "custom", message: "可继续查询的任务必须包含服务商任务 ID" });
  }
});
export type ClothingGenerationTask = z.infer<typeof ClothingGenerationTaskSchema>;
