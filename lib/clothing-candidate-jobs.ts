import type { ClothingGenerationSettings, ClothingGenerationTask } from "@/features/clothing-studio/model";
import { signDownloadUrl, signJobToken } from "./download-token";
import { GrsaiError } from "./grsai/errors";
import { submitImageGeneration } from "./grsai/images";
import type { ImageRenderConfig } from "./image-render-config";

const candidateRender: ImageRenderConfig = {
  imageIndex: 99,
  annotations: [],
  watermark: "",
  applyWatermark: false,
};

type SubmitCandidateBatchInput = {
  kind: "model" | "scene";
  count: number;
  promptForIndex: (index: number) => string;
  aspectRatio: ClothingGenerationSettings["aspectRatio"];
  quality: ClothingGenerationSettings["quality"];
  requestUrl: string;
};

function inlineCandidateUrl(requestUrl: string, token: string) {
  const url = new URL("/api/clothing/download", requestUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("inline", "1");
  return url.toString();
}

export async function submitCandidateBatch(input: SubmitCandidateBatchInput) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!tokenSecret) throw new Error("图片生成服务尚未配置");

  const slots = Array.from({ length: input.count }, () => ({
    id: `${input.kind}-${crypto.randomUUID()}`,
  }));
  const settled = await Promise.allSettled(slots.map((_, index) => submitImageGeneration({
    images: [],
    prompt: input.promptForIndex(index),
    aspectRatio: input.aspectRatio,
    quality: input.quality,
    timeoutMs: 600_000,
  })));

  return settled.map((result, index): ClothingGenerationTask => {
    const planItemId = slots[index].id;
    if (result.status === "rejected") {
      return {
        planItemId,
        status: "failed",
        progress: 0,
        error: result.reason instanceof GrsaiError
          ? result.reason.message
          : "参考图生成提交失败，请重试",
      };
    }

    const job = result.value;
    if (job.status === "failed") {
      return {
        planItemId,
        status: "failed",
        progress: job.progress,
        error: job.error ?? "参考图生成失败，请重试",
      };
    }

    const image = job.status === "succeeded" ? job.results[0] : undefined;
    if (image) {
      const downloadToken = signDownloadUrl(image.url, candidateRender, tokenSecret, undefined, 2 * 60 * 60);
      return {
        planItemId,
        status: "succeeded",
        progress: 100,
        resultUrl: inlineCandidateUrl(input.requestUrl, downloadToken),
        downloadToken,
      };
    }

    return {
      planItemId,
      providerJobId: signJobToken(job.id, candidateRender, tokenSecret),
      status: "running",
      progress: job.progress,
    };
  });
}
