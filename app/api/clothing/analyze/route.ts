import { ClothingGenerationSettingsSchema } from "@/features/clothing-studio/model";
import { resolveClothingReference } from "@/lib/clothing-reference";
import { validateClothingImages, validateClothingPostRequest } from "@/lib/clothing-upload";
import { analyzeClothing } from "@/lib/grsai/clothing-analysis";
import { GrsaiError } from "@/lib/grsai/errors";
import { z, ZodError } from "zod";

const RequirementsSchema = z.string().trim().max(1000);

export async function POST(request: Request) {
  const requestError = validateClothingPostRequest(request);
  if (requestError) return requestError;
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!process.env.GRSAI_API_KEY || !tokenSecret) {
    return Response.json({ error: "图片生成服务尚未配置" }, { status: 503 });
  }

  try {
    const form = await request.formData();
    const validated = await validateClothingImages(form, "garments", {
      min: 1,
      max: 6,
      label: "服装图",
    });
    if ("error" in validated) return Response.json(validated, { status: 400 });

    let settings: ReturnType<typeof ClothingGenerationSettingsSchema.parse>;
    let requirements: string;
    try {
      settings = ClothingGenerationSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
      requirements = RequirementsSchema.parse(String(form.get("requirements") ?? ""));
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof ZodError) {
        return Response.json({ error: "服装分析参数无效" }, { status: 400 });
      }
      throw error;
    }

    let model: string;
    let scene: string | undefined;
    try {
      model = (await resolveClothingReference(form, {
        fileField: "modelImage",
        tokenField: "modelToken",
        label: "模特图",
        required: true,
      }, tokenSecret))!;
      scene = await resolveClothingReference(form, {
        fileField: "sceneImage",
        tokenField: "sceneToken",
        label: "场景图",
        required: false,
      }, tokenSecret);
    } catch {
      return Response.json({ error: "模特图或场景图来源无效" }, { status: 400 });
    }

    const garments = await Promise.all(validated.images.map(async (file) => (
      `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
    )));
    const analysis = await analyzeClothing({ garments, model, scene, settings, requirements });
    return Response.json({ analysis });
  } catch (error) {
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "服装分析失败，请稍后重试" }, { status: 500 });
  }
}

