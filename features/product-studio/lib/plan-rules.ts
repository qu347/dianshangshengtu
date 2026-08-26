import { z } from "zod";
import {
  PlanItemSchema,
  type GenerationSettings,
  type ProductAnalysis,
} from "../model";

const chinesePlanningFields = ["title", "objective", "scene", "prompt"] as const;
const hasHanCharacter = /\p{Script=Han}/u;
const canonicalPlanId = /^[1-9]\d*$/;

const firstPlanTemplate = {
  type: "main" as const,
  title: "白底商品主图",
  objective: "完整展示当前销售商品",
  copy: "",
  scene: "纯白背景摄影棚，商品居中完整展示",
  prompt: "仅展示当前销售商品，保持结构、颜色、材质、Logo 和 SKU 不变；商品完整居中且清晰，不裁切主体；使用纯白背景，不添加营销文案、尺寸文字或其他图形。",
};

const secondPlanTemplate = {
  type: "detail" as const,
  title: "尺寸标注图",
  objective: "展示产品尺寸并保留准确比例",
  copy: "",
  scene: "商品位于画面左侧主体区，右侧保留干净的尺寸标注区",
  prompt: "生成干净的产品底图：商品放置在画面左侧约 65% 的主体区，右侧约 35% 保持干净作为右侧尺寸标注区；保持产品结构、颜色、材质、Logo 和 SKU 不变，不生成尺寸数值，程序将在右侧添加尺寸标注。",
};

export function applyPlanRules(analysis: ProductAnalysis): ProductAnalysis {
  const plan = analysis.plan.map((item, index) => {
    if (index === 0) return { ...item, ...firstPlanTemplate, annotations: [] };
    if (index !== 1) return item;

    return {
      ...item,
      ...secondPlanTemplate,
      annotations: item.annotations,
    };
  });

  return { ...analysis, plan };
}

export function assertChinesePlanningFields(analysis: ProductAnalysis): ProductAnalysis {
  for (const [index, item] of analysis.plan.entries()) {
    for (const field of chinesePlanningFields) {
      if (!hasHanCharacter.test(item[field])) {
        throw new Error(`规划内容必须使用中文：第 ${index + 1} 项的 ${field}`);
      }
    }
  }
  return analysis;
}

export function GenerationPlanItemSchema(settings: GenerationSettings) {
  return PlanItemSchema.superRefine((item, context) => {
    const imageIndex = canonicalPlanId.test(item.id) ? Number(item.id) : Number.NaN;
    if (!Number.isSafeInteger(imageIndex) || imageIndex > settings.imageCount) {
      context.addIssue({ code: "custom", path: ["id"], message: "图片序号无效" });
    }

    for (const field of chinesePlanningFields) {
      if (!hasHanCharacter.test(item[field])) {
        context.addIssue({ code: "custom", path: [field], message: "规划内容必须使用中文" });
      }
    }

    if (settings.language === "none" && item.copy.trim()) {
      context.addIssue({ code: "custom", path: ["copy"], message: "无营销文案模式下文案必须为空" });
    }

    if (imageIndex === 1) {
      if (item.type !== "main") {
        context.addIssue({ code: "custom", path: ["type"], message: "第 1 张必须是商品主图" });
      }
      if (item.copy.trim()) {
        context.addIssue({ code: "custom", path: ["copy"], message: "第 1 张不得包含营销文案" });
      }
      if (item.annotations.length > 0) {
        context.addIssue({ code: "custom", path: ["annotations"], message: "第 1 张不得包含尺寸标注" });
      }
      if (!item.scene.includes("纯白") || !item.prompt.includes("纯白背景")) {
        context.addIssue({ code: "custom", path: ["prompt"], message: "第 1 张必须明确使用纯白背景" });
      }
    }

    if (imageIndex === 2) {
      if (item.type !== "detail") {
        context.addIssue({ code: "custom", path: ["type"], message: "第 2 张必须是尺寸详情图" });
      }
      if (item.annotations.length === 0) {
        context.addIssue({ code: "custom", path: ["annotations"], message: "第 2 张必须包含尺寸标注" });
      }
      const hasDimensionLayout = item.scene.includes("左侧")
        && item.scene.includes("右侧")
        && item.prompt.includes("左侧")
        && item.prompt.includes("右侧")
        && item.prompt.includes("尺寸标注")
        && item.prompt.includes("不生成尺寸");
      if (!hasDimensionLayout) {
        context.addIssue({ code: "custom", path: ["prompt"], message: "第 2 张必须保留尺寸标注版式" });
      }
    }

    if (imageIndex > 2 && item.annotations.length > 0) {
      context.addIssue({ code: "custom", path: ["annotations"], message: "仅第 2 张可包含尺寸标注" });
    }
  });
}

export function GenerationPlanSchema(settings: GenerationSettings) {
  return z.array(GenerationPlanItemSchema(settings))
    .length(settings.imageCount, `规划数量应为 ${settings.imageCount}`)
    .superRefine((items, context) => {
      items.forEach((item, index) => {
        if (item.id !== String(index + 1)) {
          context.addIssue({ code: "custom", path: [index, "id"], message: "规划序号必须从 1 连续排列" });
        }
      });
    });
}
