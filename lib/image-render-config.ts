import { DimensionAnnotationSchema, type GenerationSettings, type PlanItem } from "@/features/product-studio/model";
import { shouldApplyWatermark } from "@/features/product-studio/lib/platform-rules";
import { fallbackDimensionLayout, type SmartDimensionLayout } from "./dimension-layout";
import type { WhiteBackgroundOptions } from "./product-image-validation";

export type ImageRenderConfig = {
  imageIndex: number;
  annotations: PlanItem["annotations"];
  dimensionLayout?: SmartDimensionLayout;
  watermark: string;
  applyWatermark: boolean;
  whiteBackgroundMode?: "apparel";
};

export function whiteBackgroundOptionsFor(
  render: ImageRenderConfig,
): WhiteBackgroundOptions | undefined {
  return render.whiteBackgroundMode === "apparel" ? { minimumChannel: 205 } : undefined;
}

function imageIndexFromId(id: string) {
  if (!/^[1-9]\d*$/.test(id)) throw new Error("图片序号无效");

  const imageIndex = Number(id);
  if (!Number.isSafeInteger(imageIndex)) throw new Error("图片序号无效");
  return imageIndex;
}

export function createImageRenderConfig(item: PlanItem, settings: GenerationSettings): ImageRenderConfig {
  const imageIndex = imageIndexFromId(item.id);
  const watermark = settings.watermark.trim();
  const isDimensionImage = imageIndex === 2 && settings.generateDimensionImage;
  const annotations = (isDimensionImage ? item.annotations : []).flatMap((annotation) => {
    const parsed = DimensionAnnotationSchema.safeParse(annotation);
    return parsed.success ? [parsed.data] : [];
  });

  return {
    imageIndex,
    annotations,
    ...(isDimensionImage ? { dimensionLayout: fallbackDimensionLayout(annotations) } : {}),
    watermark,
    applyWatermark: shouldApplyWatermark(settings.platform, imageIndex, watermark),
  };
}

export function inlineResultUrl(requestUrl: string, token: string) {
  const url = new URL("/api/product/download", requestUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("inline", "1");
  return url.toString();
}
