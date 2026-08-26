import {
  GenerationTaskSchema,
  ProductAnalysisSchema,
  assertPlanCount,
  type GenerationSettings,
  type GenerationTask,
  type DimensionItem,
  type PlanItem,
} from "../model";
import { productRequestHeaders } from "@/lib/product-upload";

export async function analyzeProductClient(input: {
  files: File[];
  settings: GenerationSettings;
  productName: string;
  requirements: string;
  dimensions: DimensionItem[];
}) {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("settings", JSON.stringify(input.settings));
  form.append("productName", input.productName);
  form.append("requirements", input.requirements);
  form.append("dimensions", JSON.stringify(input.dimensions));

  const response = await fetch("/api/product/analyze", {
    method: "POST",
    body: form,
    headers: productRequestHeaders,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "分析失败，请稍后重试");

  return assertPlanCount(ProductAnalysisSchema.parse(body.analysis), input.settings.imageCount);
}

export type ProductStudioAnalysisApi = {
  analyze: typeof analyzeProductClient;
};

export type ProductStudioApi = ProductStudioAnalysisApi & {
  submit: (input: { files: File[]; settings: GenerationSettings; item: PlanItem }) => Promise<GenerationTask>;
  status: (jobId: string, planItemId: string) => Promise<GenerationTask>;
};

export async function submitGenerationClient(input: {
  files: File[];
  settings: GenerationSettings;
  item: PlanItem;
}) {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("settings", JSON.stringify(input.settings));
  form.append("item", JSON.stringify(input.item));

  const response = await fetch("/api/product/generate", {
    method: "POST",
    body: form,
    headers: productRequestHeaders,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "提交生图任务失败");

  return GenerationTaskSchema.parse(body.task);
}

export async function getGenerationStatusClient(jobId: string, planItemId: string) {
  const response = await fetch(`/api/product/jobs/${encodeURIComponent(jobId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "查询生图任务失败");

  return GenerationTaskSchema.parse({ ...body.task, planItemId });
}
