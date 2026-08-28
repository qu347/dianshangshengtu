import { z } from "zod";
import {
  ClothingPlanItemSchema,
  type ClothingAnalysis,
  type ClothingGenerationSettings,
} from "../model";

const hasHanCharacter = /\p{Script=Han}/u;
const chineseFields = ["title", "objective", "scene", "prompt"] as const;
const requestsHollowModel = /(?:^|[，。；\n])(?:请)?(?:使用|采用|改为|变成)\s*(?:一个|为|成)?\s*(?:空心(?:隐形)?|隐形(?:空心)?)模特(?=[，。；\n]|$)/u;
const removesSelectedModel = /(?:^|[，。；\n])(?:请)?(?:不显示|不要显示|移除|删除|去掉)\s*(?:当前|该|这个)?\s*(?:所选|选中)(?:真人)?模特(?=[，。；\n]|$)/u;

const firstPlanTemplate = {
  type: "product" as const,
  title: "白底立体服装主图",
  objective: "完整准确展示当前销售服装",
  copy: "",
  scene: "纯白背景摄影棚，隐形模特式立体服装正面展示，完整居中并保留安全边距",
  prompt: "仅展示当前销售服装，保持颜色、版型、材质、纹理、图案、Logo 和 SKU 特征不变；以隐形模特式立体成衣轮廓呈现接近自然穿着时的成衣版型，肩线、领口、袖型、袖口、衣身和下摆结构自然，保留少量真实褶皱与面料垂坠；避免塑料感、悬浮感和过度平整；服装完整居中、不裁切，整张画布使用无渐变无纹理的纯白背景；不显示人物、皮肤、实体模特、衣架、道具、营销文字或尺寸标注。",
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
    if (item.type === "model" && (
      requestsHollowModel.test(item.prompt) || removesSelectedModel.test(item.prompt)
    )) {
      context.addIssue({ code: "custom", path: ["prompt"], message: "模特图必须显示所选真人模特" });
    }

    if (index === 1) {
      if (item.type !== "product") {
        context.addIssue({ code: "custom", path: ["type"], message: "第 1 张必须是白底立体主图" });
      }
      if (item.copy.trim()) {
        context.addIssue({ code: "custom", path: ["copy"], message: "第 1 张不得包含营销文案" });
      }
      const fixed = item.scene.includes("纯白背景")
        && item.prompt.includes("纯白背景")
        && item.prompt.includes("立体")
        && item.prompt.includes("不显示人物");
      if (!fixed) {
        context.addIssue({ code: "custom", path: ["prompt"], message: "第 1 张必须保持纯白立体主图规则" });
      }
    } else if (item.type === "product") {
      context.addIssue({ code: "custom", path: ["type"], message: "仅第 1 张可以是白底立体主图" });
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
