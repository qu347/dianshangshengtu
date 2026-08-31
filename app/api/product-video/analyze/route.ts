import { VideoIntroSettingsSchema } from "@/features/product-video/model";
import { analyzeIntroScript } from "@/features/product-video/lib/script";
import { GrsaiError } from "@/lib/grsai/errors";
import {
  PayloadTooLargeError,
  readBoundedFormData,
  validateProductImages,
  validateProductPostRequest,
} from "@/lib/product-upload";
import { ZodError } from "zod";

const MAX_PRODUCT_NAME_CHARS = 120;
const MAX_REQUIREMENT_CHARS = 2000;

function boundedText(value: FormDataEntryValue | null, maxChars: number) {
  return String(value ?? "").trim().slice(0, maxChars);
}

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
    const validatedImages = await validateProductImages(form);
    if ("error" in validatedImages) return Response.json(validatedImages, { status: 400 });
    const { images } = validatedImages;

    let settings: ReturnType<typeof VideoIntroSettingsSchema.parse>;
    try {
      settings = VideoIntroSettingsSchema.parse(JSON.parse(String(form.get("settings"))));
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return Response.json({ error: "生成设置无效" }, { status: 400 });
      }
      throw error;
    }

    const dataUrls = await Promise.all(images.map(async (file) => (
      `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString("base64")}`
    )));
    const script = await analyzeIntroScript({
      images: dataUrls,
      settings,
      productName: boundedText(form.get("productName"), MAX_PRODUCT_NAME_CHARS),
      requirements: boundedText(form.get("requirements"), MAX_REQUIREMENT_CHARS),
    });

    return Response.json({ script });
  } catch (error) {
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "分析失败，请稍后重试" }, { status: 500 });
  }
}
