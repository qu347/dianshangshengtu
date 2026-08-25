import { GenerationSettingsSchema } from "@/features/product-studio/model";
import { analyzeProduct } from "@/lib/grsai/analysis";
import { GrsaiError } from "@/lib/grsai/errors";
import { ZodError } from "zod";

const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const images = form.getAll("images").filter((value): value is File => value instanceof File);
    if (images.length === 0) {
      return Response.json({ error: "请至少上传 1 张产品图" }, { status: 400 });
    }
    if (images.length > 6) {
      return Response.json({ error: "最多上传 6 张产品图" }, { status: 400 });
    }
    if (images.some((file) => !allowed.has(file.type) || file.size > 5 * 1024 * 1024)) {
      return Response.json({ error: "图片格式或大小不符合要求" }, { status: 400 });
    }

    let settings: ReturnType<typeof GenerationSettingsSchema.parse>;
    try {
      settings = GenerationSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return Response.json({ error: "生成参数无效" }, { status: 400 });
      }
      throw error;
    }
    const dataUrls = await Promise.all(
      images.map(async (file) => `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`),
    );
    const analysis = await analyzeProduct({
      images: dataUrls,
      settings,
      productName: String(form.get("productName") ?? ""),
      requirements: String(form.get("requirements") ?? ""),
    });

    return Response.json({ analysis });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json({ error: "生成参数无效" }, { status: 400 });
    }
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "分析失败，请稍后重试" }, { status: 500 });
  }
}
