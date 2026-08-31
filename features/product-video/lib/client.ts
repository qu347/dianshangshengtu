import {
  IntroScriptSchema,
  ShotScriptSchema,
  VideoIntroSettings,
  VideoIntroTaskSchema,
  type IntroScript,
  type ShotScript,
  type VideoIntroTask,
} from "../model";
import { productRequestHeaders } from "@/lib/product-upload";

export class ProductVideoApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ProductVideoApiError";
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

export type ProductVideoApi = {
  analyze: (input: {
    imageFiles: File[];
    productName: string;
    requirements: string;
    settings: VideoIntroSettings;
  }) => Promise<IntroScript>;
  submit: (input: {
    productImages: File[];
    shot: ShotScript;
    settings: VideoIntroSettings;
    signal?: AbortSignal;
  }) => Promise<VideoIntroTask>;
  status: (jobToken: string, shotId: string, signal?: AbortSignal) => Promise<VideoIntroTask>;
};

export async function analyzeIntroClient(input: {
  imageFiles: File[];
  productName: string;
  requirements: string;
  settings: VideoIntroSettings;
}): Promise<IntroScript> {
  const form = new FormData();
  input.imageFiles.forEach((file) => form.append("images", file));
  form.append("productName", input.productName);
  form.append("requirements", input.requirements);
  form.append("settings", JSON.stringify(input.settings));

  const response = await fetch("/api/product-video/analyze", {
    method: "POST",
    body: form,
    headers: productRequestHeaders,
  });
  const body = await response.json();
  if (!response.ok) throw new ProductVideoApiError(body.error ?? "分析失败，请稍后重试", response.status);

  return IntroScriptSchema(input.settings.durationSec).parse(body.script);
}

export async function submitShotClient(input: {
  productImages: File[];
  shot: ShotScript;
  settings: VideoIntroSettings;
  signal?: AbortSignal;
}): Promise<VideoIntroTask> {
  const form = new FormData();
  input.productImages.forEach((file) => form.append("images", file));
  form.append("shot", JSON.stringify(input.shot));
  form.append("settings", JSON.stringify(input.settings));

  const response = await fetch("/api/product-video/generate", {
    method: "POST",
    body: form,
    headers: productRequestHeaders,
    signal: input.signal,
  });
  const body = await response.json();
  if (!response.ok) throw new ProductVideoApiError(body.error ?? "提交视频任务失败", response.status);

  return VideoIntroTaskSchema.parse(body.task);
}

export async function getShotStatusClient(jobToken: string, shotId: string, signal?: AbortSignal): Promise<VideoIntroTask> {
  const response = await fetch(`/api/product-video/jobs/${encodeURIComponent(jobToken)}`, {
    headers: productRequestHeaders,
    signal,
  });
  const body = await response.json();
  if (!response.ok) throw new ProductVideoApiError(body.error ?? "查询视频任务失败", response.status);

  return VideoIntroTaskSchema.parse({ ...body.task, shotId });
}

export async function fetchClipBlob(token: string) {
  const response = await fetch(`/api/product-video/download?token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("视频下载失败，请重试");
  return response.blob();
}

export async function fetchMergedClipBlob(tokens: string[]) {
  const response = await fetch("/api/product-video/merge", {
    method: "POST",
    body: JSON.stringify({ tokens }),
    headers: { ...productRequestHeaders, "Content-Type": "application/json" },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "视频合并失败，请重试");
  }
  return response.blob();
}
