import { z } from "zod";
import type { DimensionAnnotation } from "@/features/product-studio/model";

export const ProductBoundsSchema = z.object({
  left: z.number().int().min(0).max(1000),
  top: z.number().int().min(0).max(1000),
  right: z.number().int().min(0).max(1000),
  bottom: z.number().int().min(0).max(1000),
}).strict().superRefine((bounds, context) => {
  if (bounds.right - bounds.left < 80 || bounds.bottom - bounds.top < 80) {
    context.addIssue({ code: "custom", message: "商品边界无效" });
  }
});

export const DimensionPlacementSchema = z.object({
  id: z.string().trim().min(1).max(64),
  axis: z.enum(["horizontal", "vertical", "callout"]),
  side: z.enum(["top", "right", "bottom", "left"]),
}).strict();

export const SmartDimensionLayoutSchema = z.object({
  bounds: ProductBoundsSchema,
  placements: z.array(DimensionPlacementSchema).max(6),
}).strict();

export type ProductBounds = z.infer<typeof ProductBoundsSchema>;
export type DimensionPlacement = z.infer<typeof DimensionPlacementSchema>;
export type SmartDimensionLayout = z.infer<typeof SmartDimensionLayoutSchema>;

const fallbackPlacements = [
  { axis: "horizontal", side: "top" },
  { axis: "vertical", side: "right" },
  { axis: "horizontal", side: "bottom" },
  { axis: "vertical", side: "left" },
  { axis: "callout", side: "right" },
  { axis: "callout", side: "left" },
] as const;

export function fallbackDimensionLayout(
  annotations: DimensionAnnotation[],
): SmartDimensionLayout {
  return {
    bounds: { left: 220, top: 250, right: 780, bottom: 780 },
    placements: annotations.slice(0, 6).map((annotation, index) => ({
      id: annotation.id,
      ...fallbackPlacements[index],
    })),
  };
}

export function bindDimensionLayout(
  candidate: unknown,
  annotations: DimensionAnnotation[],
): SmartDimensionLayout {
  const parsed = SmartDimensionLayoutSchema.safeParse(candidate);
  if (!parsed.success) {
    const boundsIssue = parsed.error.issues.some((issue) => issue.path[0] === "bounds");
    throw new Error(boundsIssue ? "商品边界无效" : "尺寸布局无效");
  }
  if (
    parsed.data.placements.length !== annotations.length
    || parsed.data.placements.some((placement, index) => placement.id !== annotations[index].id)
  ) {
    throw new Error("尺寸布局 ID 必须与产品尺寸保持相同顺序");
  }
  return parsed.data;
}
