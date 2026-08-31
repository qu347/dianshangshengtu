import {
  VideoRemakeSettings,
  VideoScriptSchema,
  type VideoScript,
} from "@/features/video-remake/model";
import { GrsaiError } from "./errors";
import { grsaiFetch } from "./http";
import { z } from "zod";

const languageNames: Record<VideoRemakeSettings["language"], string> = {
  "zh-CN": "中文",
  en: "英文",
  ru: "俄文",
};

export function languageDisplayName(language: VideoRemakeSettings["language"]) {
  return languageNames[language];
}

type ScriptInput = {
  frames: string[];
  settings: VideoRemakeSettings;
  productName: string;
  requirements: string;
  videoDurationSec: number;
};

export function buildScriptPrompt(input: Pick<ScriptInput, "productName" | "requirements" | "settings" | "videoDurationSec">) {
  return [
    `分析这些参考视频画面帧，输出一条电商爆款视频的复刻分镜脚本。商品：${input.productName || "未提供"}。补充要求：${input.requirements || "无"}。`,
    `原视频约 ${input.videoDurationSec} 秒；新视频总时长必须约 ${input.settings.durationSec} 秒（允许 ±4 秒），分镜数量 1 到 8 个，每个分镜 5 到 15 秒。`,
    `新视频画面比例为 ${input.settings.aspectRatio}；分镜叠层文字必须使用${languageNames[input.settings.language]}。`,
    "保持参考视频的镜头节奏、场景切换和文字风格，但商品与模特必须替换为用户提供的商品图和模特图。",
    "只输出 JSON：{\"styleNotes\":\"参考视频风格摘要\",\"scenes\":[{\"id\":\"1\",\"title\":\"分镜标题\",\"description\":\"中文画面与运镜描述\",\"onScreenText\":\"叠层文字\",\"durationSec\":5}]}。",
    "description 必须使用中文，写清画面主体、场景、构图、运镜和节奏，将同时用于文生图与图生视频两个阶段；onScreenText 可为空字符串；不得臆造商品不具备的功效、认证或价格。",
  ].join("\n");
}

const ProviderSceneSchema = z.object({
  id: z.string().trim().min(1).max(8),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(2000),
  onScreenText: z.string().trim().max(80).default(""),
  durationSec: z.number().int().min(5).max(15),
}).strict();

const ProviderScriptSchema = z.object({
  styleNotes: z.string().trim().min(1).max(2000),
  scenes: z.array(ProviderSceneSchema).min(1).max(8),
}).strict();

function parseScriptContent(content: string, durationSec: number): VideoScript {
  const unfenced = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const provider = ProviderScriptSchema.parse(JSON.parse(unfenced));
  return VideoScriptSchema(durationSec).parse({
    styleNotes: provider.styleNotes,
    scenes: provider.scenes.map((scene, index) => ({ ...scene, id: String(index + 1) })),
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

export async function analyzeVideoScript(
  input: ScriptInput,
  fetchImpl: typeof fetch = fetch,
): Promise<VideoScript> {
  const messages = [
    { role: "system", content: "你是电商短视频分镜分析师。只输出符合要求的 JSON，不使用 Markdown。" },
    {
      role: "user",
      content: [
        { type: "text", text: buildScriptPrompt(input) },
        ...input.frames.map((url) => ({ type: "image_url", image_url: { url } })),
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
    return parseScriptContent(content, input.settings.durationSec);
  } catch {
    const repairResponse = await grsaiFetch<{ choices?: Array<{ message?: { content?: unknown } }> }>(
      "/v1/chat/completions",
      createRequest([
        ...messages,
        {
          role: "user",
          content: [
            "修复以下无效的分镜脚本。原始画面帧仍是唯一事实来源，不得臆造商品功效。",
            `分镜数量 1 到 8、每个分镜 5 到 15 秒、总时长约 ${input.settings.durationSec} 秒；叠层文字使用${languageNames[input.settings.language]}；description 必须使用中文。`,
            "只输出 JSON，不使用 Markdown。",
            "",
            content,
          ].join("\n"),
        },
      ]),
      fetchImpl,
    );
    try {
      return parseScriptContent(getContent(repairResponse), input.settings.durationSec);
    } catch {
      throw new GrsaiError("invalid_request", "分镜脚本格式异常，请重新分析", 502);
    }
  }
}
