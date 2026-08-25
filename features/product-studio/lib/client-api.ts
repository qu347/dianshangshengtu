import { ProductAnalysisSchema, assertPlanCount, type GenerationSettings } from "../model";

export async function analyzeProductClient(input: {
  files: File[];
  settings: GenerationSettings;
  productName: string;
  requirements: string;
}) {
  const form = new FormData();
  input.files.forEach((file) => form.append("images", file));
  form.append("settings", JSON.stringify(input.settings));
  form.append("productName", input.productName);
  form.append("requirements", input.requirements);

  const response = await fetch("/api/product/analyze", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "分析失败，请稍后重试");

  return assertPlanCount(ProductAnalysisSchema.parse(body.analysis), input.settings.imageCount);
}

export type ProductStudioAnalysisApi = {
  analyze: typeof analyzeProductClient;
};
