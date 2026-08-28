import {
  ClothingAnalysisSchema,
  type ClothingGenerationSettings,
} from "@/features/clothing-studio/model";
import {
  applyClothingPlanRules,
  ClothingGenerationPlanSchema,
} from "@/features/clothing-studio/lib/plan-rules";
import { targetLanguageDisplayName } from "@/features/product-studio/lib/platform-rules";
import { GrsaiError } from "./errors";
import { grsaiFetch } from "./http";

type ClothingAnalysisInput = {
  garments: string[];
  model: string;
  scene?: string;
  settings: ClothingGenerationSettings;
  requirements: string;
};

type ClothingAnalysisPromptInput = {
  settings: ClothingGenerationSettings;
  requirements: string;
  hasScene: boolean;
};

type ChatCompletion = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

const primaryModel = "gemini-3.1-flash-lite";
const fallbackModel = "gemini-2.5-flash";

const requiredFields = [
  "category",
  "productName",
  "visualFacts[{value,confidence}]",
  "audience[]",
  "sellingPoints[{title,evidence,confidence}]",
  "visualDirection",
  "plan[{id,type,title,objective,copy,scene,prompt}]",
].join(", ");

export function buildClothingAnalysisPrompt(input: ClothingAnalysisPromptInput) {
  const copyRule = input.settings.language === "none"
    ? "所有营销文案 copy 必须为空字符串。"
    : `营销文案 copy 必须使用${targetLanguageDisplayName(input.settings.language)}。`;
  const sceneRule = input.hasScene
    ? "图二及以后沿用所选场景参考图的空间、光线和视觉风格，但允许变化机位、景别和局部布置。"
    : "图二及以后自动选择与服装匹配且整组统一风格的简洁场景。";

  return [
    "分析服装参考图，并结合固定模特与可选场景制定电商组图规划。",
    `用户补充要求：${input.requirements || "无"}。`,
    `目标平台：${input.settings.platform}；目标语言：${input.settings.language}。`,
    `必须返回恰好 ${input.settings.imageCount} 个规划项，id 从 1 连续排列。`,
    "category 只能是 top、bottom、dress、coat、set。",
    "plan.type 只能是 flat_lay、model、scene、detail。",
    "标题、画面目标、场景和生图提示词必须使用中文。",
    copyRule,
    "第 1 项必须是纯白背景的服装平铺主图：服装完整居中，不出现人物、人体模型、衣架、道具、营销文字或尺寸标注。",
    "第 2 项及以后不得再使用 flat_lay；应按数量优先规划模特正面、3/4 视角、侧背面、穿搭场景和面料细节，避免重复构图。",
    "所有人物图使用同一模特，保持脸部、体型、肤色和发型一致；保持服装颜色、版型、纹理、图案、Logo 与关键结构一致。",
    sceneRule,
    "不得臆造面料成分、认证、功能、尺寸、价格或图片不可确认的信息；不确定事实标记为 inferred。",
    "visualFacts 和 sellingPoints 的 confidence 只能是 observed、inferred、user_provided。",
    `只输出 JSON，不使用 Markdown；字段必须为 ${requiredFields}。`,
  ].join("\n");
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "string") return "inferred";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "observed" || normalized === "inferred" || normalized === "user_provided"
    ? normalized
    : "inferred";
}

function normalizeProviderAnalysis(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const normalizeFacts = (items: unknown) => Array.isArray(items)
    ? items.map((item) => item && typeof item === "object" && !Array.isArray(item)
      ? { ...item, confidence: normalizeConfidence((item as Record<string, unknown>).confidence) }
      : item)
    : items;
  return {
    ...record,
    visualFacts: normalizeFacts(record.visualFacts),
    sellingPoints: normalizeFacts(record.sellingPoints),
  };
}

function parseAnalysisContent(
  content: string,
  settings: ClothingGenerationSettings,
) {
  const unfenced = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = ClothingAnalysisSchema.parse(normalizeProviderAnalysis(JSON.parse(unfenced)));
  if (parsed.plan.length !== settings.imageCount) {
    throw new Error(`规划数量应为 ${settings.imageCount}，实际为 ${parsed.plan.length}`);
  }
  const ruled = applyClothingPlanRules(parsed, settings.language);
  const plan = ClothingGenerationPlanSchema(settings).parse(ruled.plan);
  return { ...ruled, plan };
}

function completionContent(response: ChatCompletion) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI response did not contain JSON content");
  return content;
}

function requestFor(messages: unknown[], model: string) {
  return {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      stream: false,
      messages,
    }),
  };
}

async function requestAnalysis(
  messages: unknown[],
  fetchImpl: typeof fetch,
) {
  try {
    return await grsaiFetch<ChatCompletion>(
      "/v1/chat/completions",
      requestFor(messages, primaryModel),
      fetchImpl,
    );
  } catch (error) {
    if (!(error instanceof GrsaiError) || (error.code !== "upstream" && error.code !== "timeout")) {
      throw error;
    }
    return grsaiFetch<ChatCompletion>(
      "/v1/chat/completions",
      requestFor(messages, fallbackModel),
      fetchImpl,
    );
  }
}

export async function analyzeClothing(
  input: ClothingAnalysisInput,
  fetchImpl: typeof fetch = fetch,
) {
  const prompt = buildClothingAnalysisPrompt({
    settings: input.settings,
    requirements: input.requirements,
    hasScene: Boolean(input.scene),
  });
  const content = [
    { type: "text", text: prompt },
    { type: "text", text: "以下图片为服装参考图：" },
    ...input.garments.map((url) => ({ type: "image_url", image_url: { url } })),
    { type: "text", text: "以下图片为整组唯一模特参考图：" },
    { type: "image_url", image_url: { url: input.model } },
    ...(input.scene ? [
      { type: "text", text: "以下图片为可选场景风格参考图：" },
      { type: "image_url", image_url: { url: input.scene } },
    ] : []),
  ];
  const messages = [
    { role: "system", content: "你是服装电商视觉分析师。只输出符合要求的 JSON，不使用 Markdown。" },
    { role: "user", content },
  ];

  const first = await requestAnalysis(messages, fetchImpl);
  let invalidContent = "";
  try {
    invalidContent = completionContent(first);
    return parseAnalysisContent(invalidContent, input.settings);
  } catch {
    const repair = await requestAnalysis(
      [
        { role: "system", content: "你是 JSON 修复器。只修复提供的服装分析结果，不添加新事实。" },
        {
          role: "user",
          content: [
            "修复以下无效服装分析 JSON。原始图片和用户信息仍是唯一事实来源。",
            `必须包含字段 ${requiredFields}，plan 必须恰好 ${input.settings.imageCount} 项。`,
            prompt,
            "只输出 JSON，不使用 Markdown。",
            invalidContent,
          ].join("\n"),
        },
      ],
      fetchImpl,
    );
    try {
      return parseAnalysisContent(completionContent(repair), input.settings);
    } catch {
      throw new GrsaiError("invalid_request", "AI 服装分析结果格式异常，请重新分析", 502);
    }
  }
}
