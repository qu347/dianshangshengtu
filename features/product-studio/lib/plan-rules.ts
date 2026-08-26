import type { ProductAnalysis } from "../model";
import type { PreparedDimensionFact } from "./dimensions";

const chinesePlanningFields = ["title", "objective", "scene", "prompt"] as const;
const hasHanCharacter = /\p{Script=Han}/u;

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

export function applyPlanRules(analysis: ProductAnalysis, dimensionFacts: PreparedDimensionFact[]): ProductAnalysis {
  const plan = analysis.plan.map((item, index) => {
    if (index === 0) return { ...item, ...firstPlanTemplate, annotations: [] };
    if (index !== 1) return item;

    if (item.annotations.length !== dimensionFacts.length) {
      throw new Error("尺寸标注数量必须与产品尺寸数量一致");
    }

    return {
      ...item,
      ...secondPlanTemplate,
      annotations: item.annotations.map((annotation, annotationIndex) => ({
        ...annotation,
        displayValue: dimensionFacts[annotationIndex].displayValue,
      })),
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
