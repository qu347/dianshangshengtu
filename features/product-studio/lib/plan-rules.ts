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
  scene: "纯白背景摄影棚，整张画布无纹理无渐变，商品居中完整展示",
  prompt: "仅展示当前销售商品，保持结构、颜色、材质、Logo 和 SKU 不变；商品完整居中且清晰，不裁切主体，四周保留安全边距；整张画布使用纯白背景且无纹理无渐变，允许商品主体附近存在自然接触阴影；不添加营销文案、尺寸文字或其他图形。",
};

const secondPlanTemplate = {
  type: "detail" as const,
  title: "尺寸标注图",
  objective: "展示产品尺寸并保留准确比例",
  copy: "",
  scene: "纯白背景摄影棚，商品以 3/4 立体视角完整居中展示，四周留出标注空间",
  prompt: "生成完整的 3/4 立体视角商品底图，保持产品结构、颜色、材质、Logo 和 SKU 不变；整张画布使用纯白背景，商品居中完整、不裁切且四周留出标注空间；不生成任何文字、数字、单位、尺寸线、箭头或侧边面板。",
};

export function applyPlanRules(analysis: ProductAnalysis, generateDimensionImage = true): ProductAnalysis {
  const plan = analysis.plan.map((item, index) => {
    if (index === 0) return { ...item, ...firstPlanTemplate, annotations: [] };
    if (index !== 1) return item;

    if (!generateDimensionImage) return { ...item, annotations: [] };

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

    if (imageIndex === 2 && settings.generateDimensionImage) {
      if (item.type !== "detail") {
        context.addIssue({ code: "custom", path: ["type"], message: "第 2 张必须是尺寸详情图" });
      }
      if (item.annotations.length === 0) {
        context.addIssue({ code: "custom", path: ["annotations"], message: "第 2 张必须包含尺寸标注" });
      }
      const hasDimensionLayout = item.scene.includes("3/4 立体视角")
        && item.scene.includes("纯白背景")
        && item.scene.includes("标注空间")
        && item.prompt.includes("3/4 立体视角")
        && item.prompt.includes("纯白背景")
        && item.prompt.includes("四周留出标注空间")
        && item.prompt.includes("不生成任何文字、数字、单位、尺寸线、箭头或侧边面板");
      if (!hasDimensionLayout) {
        context.addIssue({ code: "custom", path: ["prompt"], message: "第 2 张必须保留尺寸标注版式" });
      }
    }

    if (imageIndex === 2 && !settings.generateDimensionImage && item.annotations.length > 0) {
      context.addIssue({ code: "custom", path: ["annotations"], message: "未启用尺寸标注图时第 2 张不得包含尺寸标注" });
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
