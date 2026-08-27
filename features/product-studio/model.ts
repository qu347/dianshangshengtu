import { z } from "zod";

export const GenerationSettingsSchema = z.object({
  platform: z.enum(["general", "taobao", "douyin", "amazon", "shopify", "ozon"]),
  language: z.enum(["none", "zh-CN", "en", "ru"]),
  aspectRatio: z.enum(["1024x1024", "1024x1536", "1536x1024", "1090x1443"]),
  imageCount: z.number().int().min(1).max(16),
  quality: z.enum(["auto", "low", "medium", "high"]),
  watermark: z.string().max(40),
}).superRefine((settings, context) => {
  const fixedLanguages = {
    taobao: "zh-CN",
    douyin: "zh-CN",
    amazon: "en",
    shopify: "en",
    ozon: "ru",
  } as const;
  const language = fixedLanguages[settings.platform as keyof typeof fixedLanguages];
  if (language && settings.language !== language) {
    context.addIssue({ code: "custom", path: ["language"], message: "平台语言必须使用固定映射" });
  }
});
export type GenerationSettings = z.infer<typeof GenerationSettingsSchema>;

export const DimensionUnitSchema = z.enum(["mm", "cm", "m", "in", "ml", "l", "custom"]);
export const DimensionItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(24),
  value: z.number().finite().positive(),
  unit: DimensionUnitSchema,
  customUnit: z.string().trim().max(12).optional(),
}).superRefine((item, context) => {
  if (item.unit === "custom" && !item.customUnit) {
    context.addIssue({ code: "custom", path: ["customUnit"], message: "请填写自定义单位" });
  }
});
export type DimensionItem = z.infer<typeof DimensionItemSchema>;

export const DimensionItemsSchema = (imageCount: number) => z.array(DimensionItemSchema)
  .max(6, "最多填写 6 个产品尺寸")
  .superRefine((items, context) => {
    if (imageCount >= 2 && items.length === 0) {
      context.addIssue({ code: "custom", message: "生成 2 张及以上时至少填写 1 个产品尺寸" });
    }
  });

export const DimensionAnnotationSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(40),
  displayValue: z.string().trim().min(1).max(40),
});
export type DimensionAnnotation = z.infer<typeof DimensionAnnotationSchema>;

const ConfidenceSchema = z.enum(["observed", "inferred", "user_provided"]);
export const PlanItemSchema = z.object({
  id: z.string().min(1), type: z.enum(["main", "detail"]), title: z.string().min(1), objective: z.string().min(1), copy: z.string(), scene: z.string().min(1), prompt: z.string().min(1),
  annotations: z.array(DimensionAnnotationSchema).max(6).default([]),
});
export type PlanItem = z.infer<typeof PlanItemSchema>;

export const ProductAnalysisSchema = z.object({
  category: z.string().min(1), productName: z.string().min(1),
  visualFacts: z.array(z.object({ value: z.string().min(1), confidence: ConfidenceSchema })),
  audience: z.array(z.string().min(1)),
  sellingPoints: z.array(z.object({ title: z.string().min(1), evidence: z.string().min(1), confidence: ConfidenceSchema })),
  visualDirection: z.string().min(1), plan: z.array(PlanItemSchema).min(1).max(16),
});
export type ProductAnalysis = z.infer<typeof ProductAnalysisSchema>;

export const GenerationTaskSchema = z.object({
  planItemId: z.string().min(1), providerJobId: z.string().min(1).optional(), status: z.enum(["queued", "submitting", "running", "succeeded", "failed", "timed_out"]), progress: z.number().min(0).max(100), resultUrl: z.string().url().optional(), downloadToken: z.string().min(1).optional(), error: z.string().min(1).optional(),
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
export type GenerationTask = z.infer<typeof GenerationTaskSchema>;

export function assertPlanCount(analysis: ProductAnalysis, expected: number) {
  if (analysis.plan.length !== expected) throw new Error(`规划数量应为 ${expected}，实际为 ${analysis.plan.length}`);
  return { ...analysis, plan: analysis.plan.map((item, index) => ({ ...item, id: String(index + 1) })) };
}
