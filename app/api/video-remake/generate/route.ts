import {
  SceneScriptSchema,
  VideoRemakeSettingsSchema,
} from "@/features/video-remake/model";
import { resolveKeyframeUrl } from "@/features/video-remake/lib/keyframe";
import { clipDownloadUrl } from "@/features/video-remake/lib/urls";
import { languageDisplayName } from "@/lib/grsai/video-script";
import { GrsaiError } from "@/lib/grsai/errors";
import { signClipUrl, signVideoJobToken } from "@/lib/download-token";
import { submitVideoTask, VideoApiError, VIDEO_QUALITY_MODELS } from "@/lib/jimeng/video";
import {
  PayloadTooLargeError,
  hasMatchingImageSignature,
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

    const modelImage = form.get("modelImage");
    let modelDataUrl: string | undefined;
    if (modelImage instanceof File && modelImage.size > 0) {
      if (modelImage.size > 5 * 1024 * 1024 || !(await hasMatchingImageSignature(modelImage))) {
        return errorResponse("模特参考图格式或大小不符合要求", 400);
      }
      modelDataUrl = `data:${modelImage.type};base64,${Buffer.from(await modelImage.arrayBuffer()).toString("base64")}`;
    }

    let scene: ReturnType<typeof SceneScriptSchema.parse>;
    let settings: ReturnType<typeof VideoRemakeSettingsSchema.parse>;
    try {
      scene = SceneScriptSchema.parse(JSON.parse(String(form.get("scene"))));
      settings = VideoRemakeSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return errorResponse("分镜或生成设置无效", 400);
      }
      throw error;
    }

    const keyframeImages = [
      ...await Promise.all(images.map(async (file) => (
        `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
      ))),
      ...(modelDataUrl ? [modelDataUrl] : []),
    ];
    const keyframePrompt = [
      scene.description,
      scene.onScreenText ? `画面中叠加${languageDisplayName(settings.language)}文字：“${scene.onScreenText}”，文字清晰可读。` : "",
      "商品与模特必须与参考图保持完全一致，商业摄影质感。",
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
        task: { sceneId: scene.id, status: "failed", progress: 0, error: "关键帧生成失败，请重试此分镜" },
      });
    }

    const videoPrompt = [
      scene.description,
      scene.onScreenText ? `画面中保持叠加${languageDisplayName(settings.language)}文字：“${scene.onScreenText}”，文字清晰稳定。` : "",
      "以首帧画面为起点自然运镜，突出商品展示，节奏与参考分镜一致。",
    ].filter(Boolean).join("\n");

    try {
      const providerTaskId = await submitVideoTask({
        prompt: videoPrompt,
        ratio: settings.aspectRatio,
        durationSec: scene.durationSec,
        firstFrameUrl: keyframeUrl,
        model: VIDEO_QUALITY_MODELS[settings.quality],
        resolution: settings.quality,
      });
      const keyframeToken = signClipUrl(keyframeUrl, tokenSecret);
      return Response.json({
        task: {
          sceneId: scene.id,
          providerJobId: signVideoJobToken(
            { providerTaskId, sceneId: scene.id, aspectRatio: settings.aspectRatio, keyframeUrl },
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
          task: { sceneId: scene.id, status: "failed", progress: 0, error: error.message },
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
