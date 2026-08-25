import {
  assertPlanCount,
  ProductAnalysisSchema,
  type GenerationSettings,
} from "@/features/product-studio/model";
import { GrsaiError } from "./errors";
import { grsaiFetch } from "./http";

type AnalysisInput = {
  images: string[];
  settings: GenerationSettings;
  productName: string;
  requirements: string;
};

type PromptInput = {
  productName: string;
  requirements: string;
  imageCount: number;
  platform: string;
  language: string;
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
  "plan[{id,type,title,objective,copy,scene,prompt}]",
].join(", ");

export function buildAnalysisPrompt(input: PromptInput) {
  return [
    `分析这些产品图片。产品名称：${input.productName || "未提供"}。`,
    `用户补充信息：${input.requirements || "无"}。目标平台：${input.platform}。目标语言：${input.language}。`,
    `必须返回恰好 ${input.imageCount} 个规划项。`,
    "不得臆造认证、功效、成分、规格或价格；无法从图片确认的内容标记为 inferred，用户提供的内容标记为 user_provided。",
    `只输出 JSON，字段为 ${requiredFields}。`,
    "plan.type 只能是 main 或 detail；所有标题、文案、场景和提示词必须适用于当前产品。",
  ].join("\n");
}

function parseAnalysisContent(content: string, expectedCount: number) {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return assertPlanCount(ProductAnalysisSchema.parse(JSON.parse(unfenced)), expectedCount);
}

function getContent(response: ChatCompletion) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI response did not contain JSON content");
  return content;
}

function createRequest(messages: unknown[]) {
  return {
    method: "POST",
    body: JSON.stringify({
      model: "gemini-3.1-flash",
      stream: false,
      messages,
    }),
  };
}

export async function analyzeProduct(input: AnalysisInput, fetchImpl: typeof fetch = fetch) {
  const expectedCount = input.settings.imageCount;
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
    return parseAnalysisContent(content, expectedCount);
  } catch {
    const repairResponse = await grsaiFetch<ChatCompletion>(
      "/v1/chat/completions",
      createRequest([
        { role: "system", content: "你是 JSON 修复器。只输出符合要求的 JSON，不使用 Markdown。" },
        {
          role: "user",
          content: `修复以下无效 JSON 分析结果。必须包含字段：${requiredFields}；plan 必须恰好 ${expectedCount} 项。不得添加原文未支持的认证、功效、成分、规格或价格。\n\n${content}`,
        },
      ]),
      fetchImpl,
    );
    try {
      return parseAnalysisContent(getContent(repairResponse), expectedCount);
    } catch {
      throw new GrsaiError("invalid_request", "AI 分析结果格式异常，请重新分析", 502);
    }
  }
}
