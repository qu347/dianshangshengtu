import type { ClothingGenerationSettings, ClothingPlanItem } from "@/features/clothing-studio/model";
import { shouldApplyWatermark } from "@/features/product-studio/lib/platform-rules";
import type { ImageRenderConfig } from "./image-render-config";

export function createClothingRenderConfig(
  item: ClothingPlanItem,
  settings: ClothingGenerationSettings,
): ImageRenderConfig {
  const imageIndex = /^[1-9]\d*$/.test(item.id) ? Number(item.id) : Number.NaN;
  if (!Number.isSafeInteger(imageIndex) || imageIndex < 1 || imageIndex > settings.imageCount) {
    throw new Error("图片序号无效");
  }
  const watermark = settings.watermark.trim();
  return {
    imageIndex,
    annotations: [],
    watermark,
    applyWatermark: shouldApplyWatermark(settings.platform, imageIndex, watermark),
  };
}

