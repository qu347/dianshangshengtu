import {
  ClothingAnalysisSchema,
  type ClothingCategory,
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
    "plan.type 只能是 product、model、scene、detail。",
    "标题、画面目标、场景和生图提示词必须使用中文。",
    copyRule,
    "第 1 项必须是纯白背景的立体服装主图：使用隐形模特式立体成衣轮廓，呈现自然肩型、领口、袖型、衣身和下摆；服装完整居中，不显示人物、皮肤或实体模特，不出现衣架、道具、营销文字或尺寸标注。",
    "第 2 项及以后不得再使用 product；应按数量优先规划模特正面、3/4 视角、侧背面、穿搭场景和面料细节，避免重复构图。",
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

const categoryAliases = {
  top: ["top", "tops", "shirt", "blouse", "t_shirt", "sweater", "hoodie", "上衣", "衬衫", "t恤"],
  bottom: ["bottom", "bottoms", "pants", "trousers", "jeans", "skirt", "shorts", "下装", "裤子", "裤装", "半身裙"],
  dress: ["dress", "gown", "one_piece", "连衣裙"],
  coat: ["coat", "jacket", "blazer", "outerwear", "外套", "大衣", "夹克"],
  set: ["set", "suit", "two_piece", "套装"],
} satisfies Record<ClothingCategory, readonly string[]>;

type PlanType = "product" | "model" | "scene" | "detail";
const planTypeAliases = {
  product: ["product", "main", "hero", "white_background", "白底主图", "立体主图", "flat_lay", "flatlay", "平铺"],
  model: ["model", "on_model", "model_on", "person", "try_on", "模特", "上身"],
  scene: ["scene", "lifestyle", "environment", "场景"],
  detail: ["detail", "close_up", "closeup", "fabric", "细节"],
} satisfies Record<PlanType, readonly string[]>;

function normalizeAlias<T extends string>(value: unknown, aliases: Record<T, readonly string[]>) {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (Object.entries(aliases) as Array<[T, readonly string[]]>)
    .find(([, values]) => values.includes(normalized))?.[0] ?? value;
}

function normalizeProviderAnalysis(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const normalizeFacts = (items: unknown) => Array.isArray(items) ? items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const fact = item as Record<string, unknown>;
    return { value: fact.value, confidence: normalizeConfidence(fact.confidence) };
  }) : items;
  const normalizeSellingPoints = (items: unknown) => Array.isArray(items) ? items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const point = item as Record<string, unknown>;
    return {
      title: point.title,
      evidence: point.evidence,
      confidence: normalizeConfidence(point.confidence),
    };
  }) : items;
  const normalizePlan = (items: unknown) => Array.isArray(items) ? items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const planItem = item as Record<string, unknown>;
    return {
      id: typeof planItem.id === "number" ? String(planItem.id) : planItem.id,
      type: normalizeAlias(planItem.type, planTypeAliases),
      title: planItem.title,
      objective: planItem.objective,
      copy: typeof planItem.copy === "string" ? planItem.copy : "",
      scene: planItem.scene,
      prompt: planItem.prompt,
    };
  }) : items;
  return {
    category: normalizeAlias(record.category, categoryAliases),
    productName: record.productName,
    visualFacts: normalizeFacts(record.visualFacts),
    audience: record.audience,
    sellingPoints: normalizeSellingPoints(record.sellingPoints),
    visualDirection: record.visualDirection,
    plan: normalizePlan(record.plan),
  };
}

function parseJsonContent(content: string) {
  const trimmed = content.trim();
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI response did not contain a JSON object");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function parseAnalysisContent(
  content: string,
  settings: ClothingGenerationSettings,
) {
  const parsed = ClothingAnalysisSchema.parse(normalizeProviderAnalysis(parseJsonContent(content)));
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
