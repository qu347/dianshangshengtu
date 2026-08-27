import type { GenerationSettings, PlanItem, ProductAnalysis } from "./model";
export const defaultSettings: GenerationSettings = { platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 2, quality: "auto", watermark: "" };
export function makePlanItems(count: number): PlanItem[] { return Array.from({ length: count }, (_, index) => ({ id: String(index + 1), type: index === 0 ? "main" : "detail", title: index === 0 ? "白底主图" : `详情图 ${index}`, objective: index === 0 ? "完整展示产品" : "展示核心卖点", copy: index === 0 ? "" : `卖点 ${index}`, scene: index === 0 ? "纯白摄影棚" : "真实使用场景", prompt: index === 0 ? "生成纯白背景商品主图" : `生成第 ${index} 张详情图`, annotations: [] })); }
export const analysisWithTwoItems: ProductAnalysis = {
  category: "杯具",
  productName: "保温杯",
  visualFacts: [{ value: "银色金属杯身", confidence: "observed" }],
  audience: ["通勤人群"],
  sellingPoints: [{ title: "便携", evidence: "用户提供", confidence: "user_provided" }],
  visualDirection: "简洁棚拍",
  plan: [
    makePlanItems(2)[0],
    {
      ...makePlanItems(2)[1],
      title: "尺寸标注图",
      objective: "展示产品尺寸并保留准确比例",
      scene: "纯白背景摄影棚，商品以 3/4 立体视角完整居中展示，四周留出标注空间",
      prompt: "生成完整的 3/4 立体视角商品底图，整张画布使用纯白背景，商品居中且四周留出标注空间；不生成任何文字、数字、单位、尺寸线、箭头或侧边面板。",
      annotations: [{ id: "height", label: "杯高", displayValue: "12 cm" }],
    },
  ],
};
export function makeImageFile(name = "product.png") { return new File(["image"], name, { type: "image/png" }); }
