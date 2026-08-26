import { GenerationSettingsSchema, PlanItemSchema } from "@/features/product-studio/model";
import { signDownloadUrl, signJobToken } from "@/lib/download-token";
import { GrsaiError } from "@/lib/grsai/errors";
import { buildGenerationPrompt, submitImageGeneration } from "@/lib/grsai/images";
import { createImageRenderConfig, inlineResultUrl } from "@/lib/image-render-config";
import { validateProductImages, validateProductPostRequest } from "@/lib/product-upload";
import { ZodError } from "zod";

export async function POST(request: Request) {
  const requestError = validateProductPostRequest(request);
  if (requestError) return requestError;

  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!process.env.GRSAI_API_KEY || !tokenSecret) {
    return Response.json({ error: "图片生成服务尚未配置" }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const validatedImages = await validateProductImages(form);
    if ("error" in validatedImages) return Response.json(validatedImages, { status: 400 });
    const { images } = validatedImages;

    let settings: ReturnType<typeof GenerationSettingsSchema.parse>;
    let item: ReturnType<typeof PlanItemSchema.parse>;
    try {
      settings = GenerationSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
      item = PlanItemSchema.parse(JSON.parse(String(form.get("item"))));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof ZodError) {
        return Response.json({ error: "生成参数或规划项无效" }, { status: 400 });
      }
      throw error;
    }

    const render = createImageRenderConfig(item, settings);
    const dataUrls = await Promise.all(images.map(async (file) => (
      `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
    )));
    const job = await submitImageGeneration({
      images: dataUrls,
      prompt: buildGenerationPrompt(item, settings),
      aspectRatio: settings.aspectRatio,
      quality: settings.quality,
    });
    const result = job.status === "succeeded" ? job.results[0] : undefined;
    const status = result ? "succeeded" : job.status === "succeeded" ? "running" : job.status;
    const signedResult = result
      ? (() => {
          const downloadToken = signDownloadUrl(result.url, render, tokenSecret);
          return {
            resultUrl: inlineResultUrl(request.url, downloadToken),
            downloadToken,
          };
        })()
      : {};

    return Response.json({
      task: {
        planItemId: item.id,
        ...(status === "running" ? {
          providerJobId: signJobToken(job.id, render, tokenSecret),
        } : {}),
        status,
        progress: job.progress,
        ...signedResult,
        ...(job.error ? { error: job.error } : {}),
      },
    });
  } catch (error) {
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "图片生成提交失败，请稍后重试" }, { status: 500 });
  }
}
