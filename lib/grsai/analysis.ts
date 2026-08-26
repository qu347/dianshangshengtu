import {
  assertPlanCount,
  ProductAnalysisSchema,
  type DimensionItem,
  type GenerationSettings,
} from "@/features/product-studio/model";
import { prepareDimensionFacts, type PreparedDimensionFact } from "@/features/product-studio/lib/dimensions";
import { applyPlanRules, assertChinesePlanningFields } from "@/features/product-studio/lib/plan-rules";
import { GrsaiError } from "./errors";
import { grsaiFetch } from "./http";

type AnalysisInput = {
  images: string[];
  settings: GenerationSettings;
  productName: string;
  requirements: string;
  dimensions: DimensionItem[];
};

type PromptInput = {
  productName: string;
  requirements: string;
  imageCount: number;
  platform: string;
  language: string;
  dimensions: PreparedDimensionFact[];
};

type ChatCompletion = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

const requiredFields = [
  "category",
  "productName",
  "visualFacts[{value,confidence}]",
  "audience[]",
  "sellingPoints[{title,evidence,confidence}]",
  "visualDirection",
  "plan[{id,type,title,objective,copy,scene,prompt,annotations[{label,displayValue}]}]",
].join(", ");

function planningRequirements(input: Pick<PromptInput, "imageCount" | "language" | "dimensions">) {
  const copyRule = input.language === "none"
    ? "营销文案 copy 必须为空字符串。"
    : `营销文案 copy 必须使用目标语言 ${input.language}。`;
  const annotationLanguage = input.language === "en" ? "英文" : input.language === "ru" ? "俄文" : "中文";
  const dimensionRules = input.dimensions.map((dimension, index) => [
    `第 ${index + 1} 个标注必须对应尺寸 ${dimension.id}，将标注标签“${dimension.sourceLabel}”翻译为${annotationLanguage}。`,
    `数值字符串“${dimension.displayValue}”必须原样返回。`,
  ].join(""));

  return [
    "所有标题、目标、场景和生图提示词必须使用中文。",
    copyRule,
    "第 1 项必须是白底商品主图，不得包含营销文案或尺寸标注。",
    ...(input.imageCount >= 2 ? [
      "第 2 项必须是尺寸标注图，商品置于左侧，右侧保留干净的尺寸标注区。",
      `第 2 项必须按输入顺序返回恰好 ${input.dimensions.length} 个 annotations，每个输入尺寸对应一个翻译后的标注标签。`,
      "annotations 中的数值字符串不得修改。",
      ...dimensionRules,
    ] : []),
  ].join("\n");
}

export function buildAnalysisPrompt(input: PromptInput) {
  return [
    `分析这些产品图片。产品名称：${input.productName || "未提供"}。`,
    `用户补充信息：${input.requirements || "无"}。目标平台：${input.platform}。目标语言：${input.language}。`,
    `必须返回恰好 ${input.imageCount} 个规划项。`,
    "不得臆造认证、功效、成分、规格或价格；无法从图片确认的内容标记为 inferred，用户提供的内容标记为 user_provided。",
    "visualFacts 和 sellingPoints 的 confidence 只能是 observed、inferred 或 user_provided。",
    `只输出 JSON，字段为 ${requiredFields}。`,
    "plan.type 只能是 main 或 detail；所有标题、文案、场景和提示词必须适用于当前产品。",
    planningRequirements(input),
  ].join("\n");
}

function normalizeConfidence(value: unknown) {
  if (typeof value !== "string") return "inferred";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "observed" || normalized === "inferred" || normalized === "user_provided") {
    return normalized;
  }
  return "inferred";
}

function normalizeProviderAnalysis(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const analysis = value as Record<string, unknown>;
  const normalizeItems = (items: unknown) => Array.isArray(items)
    ? items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item) || !("confidence" in item)) return item;
      return { ...item, confidence: normalizeConfidence(item.confidence) };
    })
    : items;
  return {
    ...analysis,
    visualFacts: normalizeItems(analysis.visualFacts),
    sellingPoints: normalizeItems(analysis.sellingPoints),
  };
}

function parseAnalysisContent(content: string, expectedCount: number, dimensionFacts: PreparedDimensionFact[]) {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const analysis = assertPlanCount(
    ProductAnalysisSchema.parse(normalizeProviderAnalysis(JSON.parse(unfenced))),
    expectedCount,
  );
  return applyPlanRules(assertChinesePlanningFields(analysis), dimensionFacts);
}

function getContent(response: ChatCompletion) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI response did not contain JSON content");
  return content;
}

function createRequest(messages: unknown[]) {
  return {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model: "gemini-3.1-flash-lite",
      stream: false,
      messages,
    }),
  };
}

export async function analyzeProduct(input: AnalysisInput, fetchImpl: typeof fetch = fetch) {
  const expectedCount = input.settings.imageCount;
  const dimensionFacts = prepareDimensionFacts(input.dimensions, input.settings.language);
  const messages = [
    { role: "system", content: "你是电商视觉分析师。只输出符合要求的 JSON，不使用 Markdown。" },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: buildAnalysisPrompt({
            productName: input.productName,
            requirements: input.requirements,
            imageCount: expectedCount,
            platform: input.settings.platform,
            language: input.settings.language,
            dimensions: dimensionFacts,
          }),
        },
        ...input.images.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    },
  ];

  const response = await grsaiFetch<ChatCompletion>("/v1/chat/completions", createRequest(messages), fetchImpl);
  let content = "";
  try {
    content = getContent(response);
    return parseAnalysisContent(content, expectedCount, dimensionFacts);
  } catch {
    const repairResponse = await grsaiFetch<ChatCompletion>(
      "/v1/chat/completions",
      createRequest([
        ...messages,
        {
          role: "user",
          content: `修复以下无效 JSON 分析结果。原始图像和用户信息仍是唯一事实来源。必须包含字段：${requiredFields}；plan 必须恰好 ${expectedCount} 项。不得臆造认证、功效、成分、规格或价格；无法从图片确认的内容标记为 inferred，用户提供的内容标记为 user_provided。visualFacts 和 sellingPoints 的 confidence 只能是 observed、inferred 或 user_provided。\n${planningRequirements({ imageCount: expectedCount, language: input.settings.language, dimensions: dimensionFacts })}\n只输出 JSON，不使用 Markdown。\n\n${content}`,
        },
      ]),
      fetchImpl,
    );
    try {
      return parseAnalysisContent(getContent(repairResponse), expectedCount, dimensionFacts);
    } catch {
      throw new GrsaiError("invalid_request", "AI 分析结果格式异常，请重新分析", 502);
    }
  }
}
