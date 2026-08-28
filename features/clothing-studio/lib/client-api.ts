import { clothingRequestHeaders } from "@/lib/clothing-upload";
import {
  ClothingAnalysisSchema,
  ClothingGenerationTaskSchema,
  type ClothingGenerationSettings,
  type ClothingGenerationTask,
  type ClothingPlanItem,
  type ModelCandidateRequest,
  type ReferenceAsset,
  type SceneCandidateRequest,
  validateReferenceAsset,
} from "../model";
import { ClothingGenerationPlanItemSchema, ClothingGenerationPlanSchema } from "./plan-rules";

export class ClothingStudioApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ClothingStudioApiError";
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

function appendReference(form: FormData, prefix: "model" | "scene", asset: ReferenceAsset) {
  validateReferenceAsset(asset);
  if (asset.source === "upload" && asset.file) {
    form.append(`${prefix}Image`, asset.file);
    return;
  }
  if (asset.source === "generated" && asset.downloadToken) {
    form.append(`${prefix}Token`, asset.downloadToken);
    return;
  }
  throw new Error(prefix === "model" ? "模特图来源无效" : "场景图来源无效");
}

async function responseBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

export async function analyzeClothingClient(input: {
  garments: File[];
  settings: ClothingGenerationSettings;
  requirements: string;
  model: ReferenceAsset;
  scene?: ReferenceAsset | null;
}) {
  const form = new FormData();
  input.garments.forEach((file) => form.append("garments", file));
  form.append("settings", JSON.stringify(input.settings));
  form.append("requirements", input.requirements);
  appendReference(form, "model", input.model);
  if (input.scene) appendReference(form, "scene", input.scene);

  const response = await fetch("/api/clothing/analyze", {
    method: "POST",
    body: form,
    headers: clothingRequestHeaders,
  });
  const body = await responseBody(response);
  if (!response.ok) throw new ClothingStudioApiError(String(body.error ?? "服装分析失败，请稍后重试"), response.status);
  const analysis = ClothingAnalysisSchema.parse(body.analysis);
  ClothingGenerationPlanSchema(input.settings).parse(analysis.plan);
  return analysis;
}

export async function submitClothingCandidatesClient(
  kind: "model",
  input: ModelCandidateRequest,
): Promise<ClothingGenerationTask[]>;
export async function submitClothingCandidatesClient(
  kind: "scene",
  input: SceneCandidateRequest,
): Promise<ClothingGenerationTask[]>;
export async function submitClothingCandidatesClient(
  kind: "model" | "scene",
  input: ModelCandidateRequest | SceneCandidateRequest,
) {
  const response = await fetch(`/api/clothing/${kind}-candidates`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...clothingRequestHeaders },
    body: JSON.stringify(input),
  });
  const body = await responseBody(response);
  if (!response.ok) throw new ClothingStudioApiError(String(body.error ?? "参考图生成失败，请重试"), response.status);
  return ClothingGenerationTaskSchema.array().parse(body.tasks);
}

export async function submitClothingGenerationClient(input: {
  garments: File[];
  settings: ClothingGenerationSettings;
  item: ClothingPlanItem;
  model?: ReferenceAsset;
  scene?: ReferenceAsset | null;
  baseImageToken?: string;
}) {
  const item = ClothingGenerationPlanItemSchema(input.settings).parse(input.item);
  const form = new FormData();
  input.garments.forEach((file) => form.append("garments", file));
  form.append("settings", JSON.stringify(input.settings));
  form.append("item", JSON.stringify(item));
  if (item.id !== "1") {
    if (!input.model) throw new Error("模特图来源无效");
    appendReference(form, "model", input.model);
    if (input.scene) appendReference(form, "scene", input.scene);
    if (input.baseImageToken) form.append("baseImageToken", input.baseImageToken);
  }

  const response = await fetch("/api/clothing/generate", {
    method: "POST",
    body: form,
    headers: clothingRequestHeaders,
  });
  const body = await responseBody(response);
  if (!response.ok) throw new ClothingStudioApiError(String(body.error ?? "提交生图任务失败"), response.status);
  return ClothingGenerationTaskSchema.parse(body.task);
}

export async function getClothingGenerationStatusClient(jobId: string, planItemId: string) {
  const response = await fetch(`/api/clothing/jobs/${encodeURIComponent(jobId)}`);
  const body = await responseBody(response);
  if (!response.ok) throw new ClothingStudioApiError(String(body.error ?? "查询生图任务失败"), response.status);
  if (!body.task || typeof body.task !== "object" || Array.isArray(body.task)) {
    throw new Error("生图任务响应格式无效");
  }
  return ClothingGenerationTaskSchema.parse({ ...body.task, planItemId });
}

export type ClothingStudioApi = {
  analyze: typeof analyzeClothingClient;
  submitCandidates: typeof submitClothingCandidatesClient;
  submit: typeof submitClothingGenerationClient;
  status: typeof getClothingGenerationStatusClient;
};
