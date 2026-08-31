import { ClothingGenerationSettingsSchema, type ClothingPlanItem } from "@/features/clothing-studio/model";
import { ClothingGenerationPlanItemSchema } from "@/features/clothing-studio/lib/plan-rules";
import { createClothingRenderConfig } from "@/lib/clothing-render-config";
import { whiteBackgroundOptionsFor } from "@/lib/image-render-config";
import { resolveClothingReference } from "@/lib/clothing-reference";
import {
  ClothingPayloadTooLargeError,
  readBoundedClothingFormData,
  validateClothingImages,
  validateClothingPostRequest,
} from "@/lib/clothing-upload";
import { signDownloadUrl, signJobToken, verifyDownloadToken } from "@/lib/download-token";
import { buildClothingGenerationPrompt } from "@/lib/grsai/clothing-images";
import { GrsaiError } from "@/lib/grsai/errors";
import { submitImageGeneration } from "@/lib/grsai/images";
import { prepareGeneratedImageResult } from "@/lib/product-image-result";
import { normalizeWhiteBackground } from "@/lib/product-image-validation";
import { fetchPublicImage } from "@/lib/remote-image";
import { ZodError } from "zod";

function hasFormValue(form: FormData, field: string) {
  return form.getAll(field).some((value) => (
    typeof value === "string" ? value.length > 0 : value.size > 0 || value.name.length > 0
  ));
}

function inlineResultUrl(requestUrl: string, token: string) {
  const url = new URL("/api/clothing/download", requestUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("inline", "1");
  return url.toString();
}

export async function POST(request: Request) {
  const requestError = validateClothingPostRequest(request);
  if (requestError) return requestError;
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!process.env.GRSAI_API_KEY || !tokenSecret) {
    return Response.json({ error: "图片生成服务尚未配置" }, { status: 503 });
  }

  try {
    const form = await readBoundedClothingFormData(request);
    const validated = await validateClothingImages(form, "garments", {
      min: 1,
      max: 6,
      label: "服装图",
    });
    if ("error" in validated) return Response.json(validated, { status: 400 });

    let settings: ReturnType<typeof ClothingGenerationSettingsSchema.parse>;
    let item: ClothingPlanItem;
    try {
      settings = ClothingGenerationSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
      item = ClothingGenerationPlanItemSchema(settings).parse(JSON.parse(String(form.get("item"))));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof ZodError) {
        return Response.json({ error: "生成参数或规划项无效" }, { status: 400 });
      }
      throw error;
    }

    const render = createClothingRenderConfig(item, settings);
    const referenceFields = ["modelImage", "modelToken", "sceneImage", "sceneToken", "baseImageToken"];
    if (render.imageIndex === 1 && referenceFields.some((field) => hasFormValue(form, field))) {
      return Response.json({ error: "第 1 张只能使用服装参考图" }, { status: 400 });
    }

    let normalizedMain: string | undefined;
    let model: string | undefined;
    let scene: string | undefined;
    if (render.imageIndex > 1) {
      try {
        const baseImageToken = form.get("baseImageToken");
        if (typeof baseImageToken !== "string" || !baseImageToken) throw new Error();
        const verified = verifyDownloadToken(baseImageToken, tokenSecret);
        if (verified.render.imageIndex !== 1) throw new Error();
        const normalized = await normalizeWhiteBackground(
          await fetchPublicImage(verified.url),
          whiteBackgroundOptionsFor(verified.render),
        );
        normalizedMain = `data:image/png;base64,${normalized.toString("base64")}`;
        model = await resolveClothingReference(form, {
          fileField: "modelImage",
          tokenField: "modelToken",
          label: "模特图",
          required: true,
        }, tokenSecret);
        scene = await resolveClothingReference(form, {
          fileField: "sceneImage",
          tokenField: "sceneToken",
          label: "场景图",
          required: false,
        }, tokenSecret);
      } catch {
        return Response.json({ error: "后续图片需要有效的主图和模特图" }, { status: 400 });
      }
    }

    const garments = await Promise.all(validated.images.map(async (file) => (
      `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
    )));
    const images = render.imageIndex === 1
      ? garments
      : [normalizedMain!, ...garments, model!, ...(scene ? [scene] : [])];
    const job = await submitImageGeneration({
      images,
      prompt: buildClothingGenerationPrompt(item, settings, { hasScene: Boolean(scene) }),
      aspectRatio: settings.aspectRatio,
      quality: settings.quality,
    });
    const result = job.status === "succeeded" ? job.results[0] : undefined;
    const prepared = result
      ? await prepareGeneratedImageResult({ url: result.url, render })
      : { ok: true as const, render };
    if (!prepared.ok) {
      return Response.json({
        task: {
          planItemId: item.id,
          status: "failed",
          progress: job.progress,
          error: prepared.error,
        },
      });
    }

    if (job.status === "failed") {
      return Response.json({
        task: {
          planItemId: item.id,
          status: "failed",
          progress: job.progress,
          error: job.error ?? "图片生成失败，请重试",
        },
      });
    }
    if (result) {
      const downloadToken = signDownloadUrl(result.url, prepared.render, tokenSecret);
      return Response.json({
        task: {
          planItemId: item.id,
          status: "succeeded",
          progress: 100,
          resultUrl: inlineResultUrl(request.url, downloadToken),
          downloadToken,
        },
      });
    }
    return Response.json({
      task: {
        planItemId: item.id,
        providerJobId: signJobToken(job.id, render, tokenSecret),
        status: "running",
        progress: job.progress,
      },
    });
  } catch (error) {
    if (error instanceof ClothingPayloadTooLargeError) {
      return Response.json({ error: error.message }, { status: 413 });
    }
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "图片生成提交失败，请稍后重试" }, { status: 500 });
  }
}
