import { GenerationSettingsSchema, PlanItemSchema } from "@/features/product-studio/model";
import { GrsaiError } from "@/lib/grsai/errors";
import { buildGenerationPrompt, submitImageGeneration } from "@/lib/grsai/images";
import { ZodError } from "zod";

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 5 * 1024 * 1024;
const maxRequestBytes = 36 * 1024 * 1024;

export async function POST(request: Request) {
  if (!process.env.GRSAI_API_KEY) {
    return Response.json({ error: "图片生成服务尚未配置" }, { status: 503 });
  }
  if (Number(request.headers.get("Content-Length")) > maxRequestBytes) {
    return Response.json({ error: "请求体不能超过 36 MB" }, { status: 413 });
  }

  try {
    const form = await request.formData();
    const images = form.getAll("images").filter((value): value is File => value instanceof File);
    if (images.length === 0) {
      return Response.json({ error: "请至少上传 1 张产品图" }, { status: 400 });
    }
    if (images.length > 6) {
      return Response.json({ error: "最多上传 6 张产品图" }, { status: 400 });
    }
    if (images.some((file) => !allowedImageTypes.has(file.type) || file.size > maxImageBytes)) {
      return Response.json({ error: "图片格式或大小不符合要求" }, { status: 400 });
    }

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

    const dataUrls = await Promise.all(images.map(async (file) => (
      `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
    )));
    const job = await submitImageGeneration({
      images: dataUrls,
      prompt: buildGenerationPrompt(item, settings),
      aspectRatio: settings.aspectRatio,
      quality: settings.quality,
    });

    return Response.json({
      task: {
        planItemId: item.id,
        providerJobId: job.id,
        status: job.status,
        progress: job.progress,
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
