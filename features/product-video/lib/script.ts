import type { VideoIntroSettings, IntroScript } from "../model";
import { IntroScriptSchema } from "../model";
import { GrsaiError } from "@/lib/grsai/errors";
import { grsaiFetch } from "@/lib/grsai/http";
import { languageDisplayName } from "@/lib/grsai/video-script";
import { z } from "zod";

type ScriptInput = {
  images: string[];
  settings: VideoIntroSettings;
  productName: string;
  requirements: string;
};

export function buildIntroScriptPrompt(input: Pick<ScriptInput, "productName" | "requirements" | "settings">) {
  return [
    `根据这些商品图，输出一条淘宝详情页主图风格的商品介绍视频分镜脚本。商品：${input.productName || "未提供"}。卖点与要求：${input.requirements || "无"}。`,
    `视频总时长必须约 ${input.settings.durationSec} 秒（允许 ±4 秒），镜头数量 1 到 6 个，每个镜头 5 到 15 秒；总时长不超过 15 秒时优先只输出 1 个完整长镜头，不要拆分。`,
    `视频画面比例为 ${input.settings.aspectRatio}；镜头叠层文字必须使用${languageDisplayName(input.settings.language)}。`,
    "整体风格：黑金质感背景、高级商业广告光效，商品特写运镜，大字号卖点文字叠层醒目清晰。",
    "只输出 JSON：{\"styleNotes\":\"整体风格摘要\",\"shots\":[{\"id\":\"1\",\"title\":\"镜头标题\",\"description\":\"中文画面与运镜描述\",\"onScreenText\":\"叠层文字\",\"durationSec\":10}]}。",
    "description 必须使用中文，写清画面主体、背景光效、构图与运镜节奏，将同时用于文生图与图生视频两个阶段；onScreenText 只能来自用户提供的商品名或卖点，可为空字符串；不得臆造商品不具备的功效、认证、参数或价格。",
  ].join("\n");
}

const ProviderShotSchema = z.object({
  id: z.string().trim().min(1).max(8),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(2000),
  onScreenText: z.string().trim().max(80).default(""),
  durationSec: z.number().int().min(4).max(15),
}).strict();

const ProviderIntroScriptSchema = z.object({
  styleNotes: z.string().trim().min(1).max(2000),
  shots: z.array(ProviderShotSchema).min(1).max(6),
}).strict();

function parseIntroScriptContent(content: string, durationSec: number): IntroScript {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const provider = ProviderIntroScriptSchema.parse(JSON.parse(unfenced));
  return IntroScriptSchema(durationSec).parse({
    styleNotes: provider.styleNotes,
    shots: provider.shots.map((shot, index) => ({ ...shot, id: String(index + 1) })),
  });
}

function getContent(response: { choices?: Array<{ message?: { content?: unknown } }> }) {
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

export async function analyzeIntroScript(
  input: ScriptInput,
  fetchImpl: typeof fetch = fetch,
): Promise<IntroScript> {
  const messages = [
    { role: "system", content: "你是电商商品介绍视频的分镜策划师。只输出符合要求的 JSON，不使用 Markdown。" },
    {
      role: "user",
      content: [
        { type: "text", text: buildIntroScriptPrompt(input) },
        ...input.images.map((url) => ({ type: "image_url", image_url: { url } })),
      ],
    },
  ];

  const response = await grsaiFetch<{ choices?: Array<{ message?: { content?: unknown } }> }>(
    "/v1/chat/completions",
    createRequest(messages),
    fetchImpl,
  );
  let content = "";
  try {
    content = getContent(response);
    return parseIntroScriptContent(content, input.settings.durationSec);
  } catch {
    const repairResponse = await grsaiFetch<{ choices?: Array<{ message?: { content?: unknown } }> }>(
      "/v1/chat/completions",
      createRequest([
        ...messages,
        {
          role: "user",
          content: [
            "修复以下无效的分镜脚本。原始商品图仍是唯一事实来源，叠层文字只能来自用户输入，不得臆造商品功效。",
            `镜头数量 1 到 6、每个镜头 5 到 15 秒、总时长约 ${input.settings.durationSec} 秒；叠层文字使用${languageDisplayName(input.settings.language)}；description 必须使用中文。`,
            "只输出 JSON，不使用 Markdown。",
            "",
            content,
          ].join("\n"),
        },
      ]),
      fetchImpl,
    );
    try {
      return parseIntroScriptContent(getContent(repairResponse), input.settings.durationSec);
    } catch {
      throw new GrsaiError("invalid_request", "分镜脚本格式异常，请重新分析", 502);
    }
  }
}
