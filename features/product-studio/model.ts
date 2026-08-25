import { z } from "zod";

export const GenerationSettingsSchema = z.object({
  platform: z.enum(["general", "taobao", "douyin", "amazon", "shopify"]),
  language: z.enum(["none", "zh-CN", "en"]),
  aspectRatio: z.enum(["1024x1024", "1024x1536", "1536x1024"]),
  imageCount: z.number().int().min(1).max(16),
  quality: z.enum(["auto", "low", "medium", "high"]),
});
export type GenerationSettings = z.infer<typeof GenerationSettingsSchema>;

const ConfidenceSchema = z.enum(["observed", "inferred", "user_provided"]);
export const PlanItemSchema = z.object({
  id: z.string().min(1), type: z.enum(["main", "detail"]), title: z.string().min(1), objective: z.string().min(1), copy: z.string(), scene: z.string().min(1), prompt: z.string().min(1),
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
});
export type GenerationTask = z.infer<typeof GenerationTaskSchema>;

export function assertPlanCount(analysis: ProductAnalysis, expected: number) {
  if (analysis.plan.length !== expected) throw new Error(`规划数量应为 ${expected}，实际为 ${analysis.plan.length}`);
  return { ...analysis, plan: analysis.plan.map((item, index) => ({ ...item, id: String(index + 1) })) };
}
