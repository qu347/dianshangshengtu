import { VideoRemakeSettingsSchema } from "@/features/video-remake/model";
import { analyzeVideoScript } from "@/lib/grsai/video-script";
import { GrsaiError } from "@/lib/grsai/errors";
import { normalizeUploadedImage } from "@/lib/product-image-validation";
import {
  PayloadTooLargeError,
  readBoundedFormData,
  validateProductPostRequest,
} from "@/lib/product-upload";
import { ZodError } from "zod";

const MAX_FRAME_BYTES = 5 * 1024 * 1024;
const ACCEPTED_FRAME_TYPES = new Set(["image/jpeg", "image/png"]);

export async function POST(request: Request) {
  const requestError = validateProductPostRequest(request);
  if (requestError) return requestError;

  let form: FormData;
  try {
    form = await readBoundedFormData(request);
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return Response.json({ error: "请求体不能超过 36 MB" }, { status: 413 });
    }
    return Response.json({ error: "请求格式无效" }, { status: 400 });
  }

  try {
    const frames = form.getAll("frames").filter((value): value is File => value instanceof File);
    if (frames.length === 0 || frames.length > 8) {
      return Response.json({ error: "参考视频画面帧无效" }, { status: 400 });
    }
    if (frames.some((file) => !ACCEPTED_FRAME_TYPES.has(file.type) || file.size > MAX_FRAME_BYTES)) {
      return Response.json({ error: "参考视频画面帧无效" }, { status: 400 });
    }

    const videoDurationSec = Number(form.get("videoDurationSec"));
    if (!Number.isFinite(videoDurationSec) || videoDurationSec < 0.5 || videoDurationSec > 90) {
      return Response.json({ error: "参考视频时长无效" }, { status: 400 });
    }

    let settings: ReturnType<typeof VideoRemakeSettingsSchema.parse>;
    try {
      settings = VideoRemakeSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return Response.json({ error: "生成设置无效" }, { status: 400 });
      }
      throw error;
    }

    const dataUrls: string[] = [];
    try {
      for (const file of frames) {
        const normalized = await normalizeUploadedImage(Buffer.from(await file.arrayBuffer()));
        dataUrls.push(`data:image/webp;base64,${normalized.toString("base64")}`);
      }
    } catch {
      return Response.json({ error: "图片格式或大小不符合要求" }, { status: 400 });
    }
    const script = await analyzeVideoScript({
      frames: dataUrls,
      settings,
      productName: String(form.get("productName") ?? ""),
      requirements: String(form.get("requirements") ?? ""),
      videoDurationSec,
    });

    return Response.json({ script });
  } catch (error) {
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "分析失败，请稍后重试" }, { status: 500 });
  }
}
