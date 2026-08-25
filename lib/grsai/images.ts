import type { GenerationSettings, PlanItem } from "@/features/product-studio/model";
import { GrsaiError } from "./errors";
import { grsaiFetch } from "./http";

type SubmitImageInput = {
  images: string[];
  prompt: string;
  aspectRatio: GenerationSettings["aspectRatio"];
  quality: GenerationSettings["quality"];
};

type ProviderImageResponse = {
  id?: unknown;
  status?: unknown;
  progress?: unknown;
  results?: unknown;
  failure_reason?: unknown;
};

export type ProviderImageJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  progress: number;
  results: Array<{ url: string }>;
  error?: string;
};

export function buildGenerationPrompt(item: PlanItem, settings: GenerationSettings) {
  return [
    "严格保持参考图中的产品结构、颜色、材质细节和 Logo，不改变 SKU 本体。",
    `图片类型：${item.type === "main" ? "商品主图" : "商品详情图"}。`,
    `任务目标：${item.objective}。场景：${item.scene}。`,
    item.copy ? `展示文案：${item.copy}。` : "",
    `用户确认的提示词：${item.prompt}。`,
    settings.language === "none"
      ? "画面中不要生成任何文字。"
      : `文案语言必须为 ${settings.language === "zh-CN" ? "中文" : "英文"}。`,
  ].filter(Boolean).join("\n");
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeImageJob(response: ProviderImageResponse): ProviderImageJob {
  if (response.failure_reason === "input_moderation" || response.failure_reason === "output_moderation") {
    throw new GrsaiError("moderation", "图片未通过内容审核", 422);
  }
  if (typeof response.id !== "string" || !response.id) {
    throw new GrsaiError("upstream", "图片生成服务响应格式异常，请重试", 502);
  }

  const status = response.status === "succeeded"
    ? "succeeded"
    : response.status === "failed"
      ? "failed"
      : "running";
  const results = Array.isArray(response.results)
    ? response.results.flatMap((result) => {
      if (typeof result !== "object" || result === null || !("url" in result) || typeof result.url !== "string") {
        return [];
      }
      return isHttpsUrl(result.url) ? [{ url: result.url }] : [];
    })
    : [];

  if (status === "succeeded" && results.length === 0) {
    throw new GrsaiError("upstream", "图片生成结果尚不可用，请继续查询", 502);
  }

  return {
    id: response.id,
    status,
    progress: typeof response.progress === "number"
      ? Math.min(100, Math.max(0, response.progress))
      : status === "succeeded"
        ? 100
        : 0,
    results,
    ...(status === "failed" ? { error: "图片生成失败，请重试" } : {}),
  };
}

export async function submitImageGeneration(input: SubmitImageInput, fetchImpl: typeof fetch = fetch) {
  const response = await grsaiFetch<ProviderImageResponse>(
    "/v1/api/generate",
    {
      method: "POST",
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: input.prompt,
        images: input.images,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        replyType: "json",
      }),
    },
    fetchImpl,
  );
  return normalizeImageJob(response);
}

export async function getImageGenerationResult(id: string, fetchImpl: typeof fetch = fetch) {
  const response = await grsaiFetch<ProviderImageResponse>(
    `/v1/api/result?id=${encodeURIComponent(id)}`,
    { method: "GET" },
    fetchImpl,
  );
  return normalizeImageJob(response);
}
