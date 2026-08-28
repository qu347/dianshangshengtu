import { z } from "zod";
import {
  ClothingPlanItemSchema,
  type ClothingAnalysis,
  type ClothingGenerationSettings,
} from "../model";

const hasHanCharacter = /\p{Script=Han}/u;
const chineseFields = ["title", "objective", "scene", "prompt"] as const;

const firstPlanTemplate = {
  type: "flat_lay" as const,
  title: "白底服装平铺主图",
  objective: "完整准确展示当前销售服装",
  copy: "",
  scene: "纯白背景摄影棚，服装正面平铺、完整居中并保留安全边距",
  prompt: "仅展示当前销售服装，保持颜色、版型、材质、纹理、图案、Logo 和 SKU 特征不变；服装正面平铺、完整居中、不裁切；整张画布使用无渐变无纹理的纯白背景；不出现人物、人体模型、衣架、道具、营销文字或尺寸标注。",
};

export function applyClothingPlanRules(
  analysis: ClothingAnalysis,
  language: ClothingGenerationSettings["language"] = "zh-CN",
): ClothingAnalysis {
  return {
    ...analysis,
    plan: analysis.plan.map((item, index) => ({
      ...item,
      id: String(index + 1),
      ...(index === 0 ? firstPlanTemplate : {}),
      ...(language === "none" ? { copy: "" } : {}),
    })),
  };
}

export function ClothingGenerationPlanItemSchema(settings: ClothingGenerationSettings) {
  return ClothingPlanItemSchema.superRefine((item, context) => {
    for (const field of chineseFields) {
      if (!hasHanCharacter.test(item[field])) {
        context.addIssue({ code: "custom", path: [field], message: "规划内容必须使用中文" });
      }
    }

    const index = /^[1-9]\d*$/.test(item.id) ? Number(item.id) : Number.NaN;
    if (!Number.isSafeInteger(index) || index > settings.imageCount) {
      context.addIssue({ code: "custom", path: ["id"], message: "图片序号无效" });
    }
    if (settings.language === "none" && item.copy.trim()) {
      context.addIssue({ code: "custom", path: ["copy"], message: "无营销文案模式下文案必须为空" });
    }

    if (index === 1) {
      if (item.type !== "flat_lay") {
        context.addIssue({ code: "custom", path: ["type"], message: "第 1 张必须是白底平铺图" });
      }
      if (item.copy.trim()) {
        context.addIssue({ code: "custom", path: ["copy"], message: "第 1 张不得包含营销文案" });
      }
      const fixed = item.scene.includes("纯白背景")
        && item.prompt.includes("纯白背景")
        && item.prompt.includes("平铺")
        && item.prompt.includes("不出现人物");
      if (!fixed) {
        context.addIssue({ code: "custom", path: ["prompt"], message: "第 1 张必须保持纯白平铺规则" });
      }
    } else if (item.type === "flat_lay") {
      context.addIssue({ code: "custom", path: ["type"], message: "仅第 1 张可以是白底平铺图" });
    }
  });
}

export function ClothingGenerationPlanSchema(settings: ClothingGenerationSettings) {
  return z.array(ClothingGenerationPlanItemSchema(settings))
    .length(settings.imageCount, `规划数量应为 ${settings.imageCount}`)
    .superRefine((items, context) => {
      items.forEach((item, index) => {
        if (item.id !== String(index + 1)) {
          context.addIssue({
            code: "custom",
            path: [index, "id"],
            message: "规划序号必须从 1 连续排列",
          });
        }
      });
    });
}
