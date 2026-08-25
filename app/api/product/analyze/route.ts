import { GenerationSettingsSchema } from "@/features/product-studio/model";
import { analyzeProduct } from "@/lib/grsai/analysis";
import { GrsaiError } from "@/lib/grsai/errors";
import { validateProductImages, validateProductPostRequest } from "@/lib/product-upload";
import { ZodError } from "zod";

export async function POST(request: Request) {
  const requestError = validateProductPostRequest(request);
  if (requestError) return requestError;

  try {
    const form = await request.formData();
    const validatedImages = await validateProductImages(form);
    if ("error" in validatedImages) return Response.json(validatedImages, { status: 400 });
    const { images } = validatedImages;

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
