import type {
  ModelCandidateRequest,
  SceneCandidateRequest,
} from "@/features/clothing-studio/model";

const modelLabels = {
  gender: { female: "女性", male: "男性" },
  ageRange: { "18-25": "18–25 岁", "26-35": "26–35 岁", "36-45": "36–45 岁", "46-plus": "46 岁以上" },
  appearance: { asian: "亚洲人外观", white: "白人外观", black: "黑人外观", latino: "拉丁裔外观", "middle-eastern": "中东人外观", custom: "按补充要求" },
  bodyType: { slim: "纤细体型", regular: "匀称体型", curvy: "曲线体型", athletic: "运动体型", "plus-size": "大码体型" },
  hairstyle: { short: "短发", medium: "中长发", long: "长发", tied: "束发", custom: "按补充要求" },
} as const;

const sceneLabels = {
  style: { mobile: "手机网感", editorial: "杂志编辑风", minimal: "极简商业风", luxury: "轻奢质感", lifestyle: "生活方式感", custom: "按补充要求" },
  venue: { studio: "摄影棚", indoor: "室内空间", outdoor: "户外", street: "街头", home: "居家空间", custom: "按补充要求" },
  lighting: { natural: "自然光", "soft-studio": "柔和棚拍光", sunny: "明亮阳光", moody: "氛围光", custom: "按补充要求" },
  season: { all: "无明确季节", spring: "春季", summer: "夏季", autumn: "秋季", winter: "冬季" },
} as const;

export function buildModelCandidatePrompt(input: ModelCandidateRequest, variationIndex: number) {
  return [
    "生成可用于服装电商试穿参考的写实模特全身照。",
    `模特：${modelLabels.gender[input.gender]}，${modelLabels.ageRange[input.ageRange]}，${modelLabels.appearance[input.appearance]}，${modelLabels.bodyType[input.bodyType]}，${modelLabels.hairstyle[input.hairstyle]}。`,
    "采用自然、有时尚感的站姿，身体比例自然且全身完整清晰。",
    "手臂不遮挡躯干和腰线，头发不遮挡肩部与领口。",
    "穿简洁贴身的中性基础服装，不穿外套，不使用遮挡身体的复杂配饰。",
    "背景简洁，单人，不出现文字、Logo 或其他人物。",
    `这是第 ${variationIndex + 1} 个构图变化，改变轻微站姿和镜头但保持上述条件。`,
    input.requirements ? `其他要求：${input.requirements}。` : "",
  ].filter(Boolean).join("\n");
}

export function buildSceneCandidatePrompt(input: SceneCandidateRequest, variationIndex: number) {
  return [
    "生成可用于服装电商组图的写实空场景参考图。",
    `视觉风格：${sceneLabels.style[input.style]}；场所：${sceneLabels.venue[input.venue]}；光线：${sceneLabels.lighting[input.lighting]}；季节：${sceneLabels.season[input.season]}。`,
    "空间层次清晰，构图适合后续放置全身模特。",
    "画面不出现人物、服装、商品、Logo 或可读文字。",
    `这是第 ${variationIndex + 1} 个构图变化，保持同类视觉风格并改变机位和局部布置。`,
    input.requirements ? `其他要求：${input.requirements}。` : "",
  ].filter(Boolean).join("\n");
}
