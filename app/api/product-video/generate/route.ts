import {
  ShotScriptSchema,
  VideoIntroSettingsSchema,
} from "@/features/product-video/model";
import { resolveKeyframeUrl } from "@/features/product-video/lib/keyframe";
import { clipDownloadUrl } from "@/features/product-video/lib/urls";
import { languageDisplayName } from "@/lib/grsai/video-script";
import { GrsaiError } from "@/lib/grsai/errors";
import { signKeyframeUrl, signVideoJobToken } from "@/lib/download-token";
import { submitVideoTask, VIDEO_QUALITY_MODELS, VideoApiError } from "@/lib/jimeng/video";
import {
  PayloadTooLargeError,
  readBoundedFormData,
  validateProductImages,
  validateProductPostRequest,
} from "@/lib/product-upload";
import { ZodError } from "zod";

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const requestError = validateProductPostRequest(request);
  if (requestError) return requestError;

  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!process.env.GRSAI_API_KEY || !tokenSecret || !process.env.VIDEO_API_KEY) {
    return errorResponse("视频生成服务尚未配置", 503);
  }

  let form: FormData;
  try {
    form = await readBoundedFormData(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return errorResponse("请求体不能超过 36 MB", 413);
    }
    return errorResponse("请求格式无效", 400);
  }

  try {
    const validatedImages = await validateProductImages(form);
    if ("error" in validatedImages) return Response.json(validatedImages, { status: 400 });
    const { images } = validatedImages;

    let shot: ReturnType<typeof ShotScriptSchema.parse>;
    let settings: ReturnType<typeof VideoIntroSettingsSchema.parse>;
    try {
      shot = ShotScriptSchema.parse(JSON.parse(String(form.get("shot"))));
      settings = VideoIntroSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return errorResponse("镜头或生成设置无效", 400);
      }
      throw error;
    }

    const keyframeImages = await Promise.all(images.map(async (file) => (
      `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
    )));
    const keyframePrompt = [
      shot.description,
      shot.onScreenText ? `画面中叠加${languageDisplayName(settings.language)}大字号卖点文字：“${shot.onScreenText}”，文字排版醒目、清晰可读。` : "",
      "黑金质感背景，高级商业广告光效，商品必须与参考图保持完全一致，商业摄影质感。",
    ].filter(Boolean).join("\n");

    let keyframeUrl: string;
    try {
      keyframeUrl = await resolveKeyframeUrl({
        images: keyframeImages,
        prompt: keyframePrompt,
        aspectRatio: settings.aspectRatio,
      });
    } catch {
      return Response.json({
        task: { shotId: shot.id, status: "failed", progress: 0, error: "关键帧生成失败，请重试此镜头" },
      });
    }

    const videoPrompt = [
      shot.description,
      shot.onScreenText ? `画面中保持叠加${languageDisplayName(settings.language)}大字号卖点文字：“${shot.onScreenText}”，文字清晰稳定不变形。` : "",
      "以首帧画面为起点自然运镜，突出商品特写与质感，节奏干脆，符合电商主图视频风格。",
    ].filter(Boolean).join("\n");

    try {
      const providerTaskId = await submitVideoTask({
        prompt: videoPrompt,
        ratio: settings.aspectRatio,
        durationSec: shot.durationSec,
        firstFrameUrl: keyframeUrl,
        model: VIDEO_QUALITY_MODELS[settings.resolution],
        // Match the resolution pinned by the selected nd-seedance model.
        resolution: settings.resolution,
      });
      const keyframeToken = signKeyframeUrl(keyframeUrl, tokenSecret);
      return Response.json({
        task: {
          shotId: shot.id,
          providerJobId: signVideoJobToken(
            { providerTaskId, sceneId: shot.id, aspectRatio: settings.aspectRatio, keyframeUrl },
            tokenSecret,
          ),
          status: "running",
          progress: 0,
          keyframeUrl: clipDownloadUrl(request.url, keyframeToken, true),
          keyframeToken,
        },
      });
    } catch (error) {
      if (error instanceof VideoApiError) {
        return Response.json({
          task: { shotId: shot.id, status: "failed", progress: 0, error: error.message },
        });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof GrsaiError) {
      return errorResponse(error.message, error.status);
    }
    return errorResponse("视频任务提交失败，请稍后重试", 500);
  }
}
