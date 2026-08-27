import type { DimensionAnnotation } from "@/features/product-studio/model";
import {
  bindDimensionLayout,
  fallbackDimensionLayout,
  type SmartDimensionLayout,
} from "@/lib/dimension-layout";
import { grsaiFetch } from "./http";

type ChatCompletion = {
  choices?: Array<{ message?: { content?: unknown } }>;
};

function getContent(response: ChatCompletion) {
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("AI response did not contain JSON content");
  return content;
}

function parseLayout(content: string, annotations: DimensionAnnotation[]): SmartDimensionLayout {
  const json = content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  return bindDimensionLayout(JSON.parse(json), annotations);
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

function placementPrompt(annotations: DimensionAnnotation[]) {
  const facts = annotations.map(({ id, label }) => ({ id, label }));
  return [
    "识别纯白背景商品图中商品主体的边界，并为每个尺寸选择最清晰的标注方向和侧边。",
    "只输出 JSON，不使用 Markdown。",
    "bounds 使用 0 到 1000 的整数坐标，必须只包围商品主体且 left < right、top < bottom。",
    "placements 必须与输入尺寸 ID 数量和顺序完全一致。",
    "axis 只能是 horizontal、vertical 或 callout；side 只能是 top、right、bottom 或 left。",
    "不得返回、猜测或改写任何尺寸数值和单位。",
    `尺寸：${JSON.stringify(facts)}。`,
    "输出格式：{\"bounds\":{\"left\":180,\"top\":220,\"right\":820,\"bottom\":820},\"placements\":[{\"id\":\"尺寸ID\",\"axis\":\"horizontal\",\"side\":\"top\"}]}。",
  ].join("\n");
}

export async function analyzeDimensionLayout(
  input: { image: string; annotations: DimensionAnnotation[] },
  fetchImpl: typeof fetch = fetch,
): Promise<SmartDimensionLayout> {
  const fallback = fallbackDimensionLayout(input.annotations);
  const messages = [
    { role: "system", content: "你是商品尺寸图排版分析师，只返回严格 JSON。" },
    {
      role: "user",
      content: [
        { type: "text", text: placementPrompt(input.annotations) },
        { type: "image_url", image_url: { url: input.image } },
      ],
    },
  ];

  let invalidContent = "";
  try {
    const response = await grsaiFetch<ChatCompletion>(
      "/v1/chat/completions",
      createRequest(messages),
      fetchImpl,
    );
    try {
      invalidContent = getContent(response);
      return parseLayout(invalidContent, input.annotations);
    } catch {
      // One repair request is allowed below.
    }
  } catch {
    return fallback;
  }

  try {
    const repaired = await grsaiFetch<ChatCompletion>(
      "/v1/chat/completions",
      createRequest([
        ...messages,
        {
          role: "user",
          content: [
            "修复上一条无效结果。只返回严格 JSON；尺寸 ID 必须按输入顺序完整返回；不得返回尺寸数值或单位。",
            invalidContent,
          ].join("\n"),
        },
      ]),
      fetchImpl,
    );
    return parseLayout(getContent(repaired), input.annotations);
  } catch {
    return fallback;
  }
}
