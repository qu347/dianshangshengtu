// Client for the Jimengvip (xinmeng) video generation API.
// Endpoint docs: https://www.jimengvip.online/docs/api-guide.html
// Submit: POST {base}/videos/generations -> { task_id }
// Poll:   GET  {base}/tasks/{task_id}     -> { status, progress, result?, error? }
// The base URL must include "www".

export type VideoErrorCode =
  | "auth"
  | "balance"
  | "rate_limit"
  | "invalid_request"
  | "upstream"
  | "timeout";

export class VideoApiError extends Error {
  constructor(
    public code: VideoErrorCode,
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

const BASE_URL = process.env.VIDEO_API_BASE_URL ?? "https://www.jimengvip.online/v1";
const DEFAULT_VIDEO_MODEL = "dvc-seedance-2.5";

// The two selectable quality tiers; each model pins its own resolution.
export const VIDEO_QUALITY_MODELS = {
  "480p": "nd-seedance-2.0-480p",
  "720p": "nd-seedance-2.0-720p",
} as const;
export type VideoQuality = keyof typeof VIDEO_QUALITY_MODELS;
type VideoQualityModel = (typeof VIDEO_QUALITY_MODELS)[VideoQuality];

type SubmitVideoResponse = {
  task_id?: unknown;
  id?: unknown;
};

type TaskQueryResponse = {
  status?: unknown;
  progress?: unknown;
  result?: unknown;
  result_url?: unknown;
  video_url?: unknown;
  error?: { message?: unknown } | unknown;
};

export type ProviderVideoStatus =
  | { status: "running"; progress: number }
  | { status: "succeeded"; resultUrl: string }
  | { status: "failed"; error: string };

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function jimengFetch<T>(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<T> {
  const apiKey = process.env.VIDEO_API_KEY;
  if (!apiKey) throw new VideoApiError("auth", "服务端尚未配置 VIDEO_API_KEY", 503);

  let response: Response;
  try {
    response = await fetchImpl(`${BASE_URL}${path}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(60_000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new VideoApiError("timeout", "视频服务请求超时，请重试", 504);
    }
    throw new VideoApiError("upstream", "无法连接视频生成服务", 502);
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new VideoApiError("auth", "视频服务 API Key 无效", response.status);
    }
    if (response.status === 402) {
      throw new VideoApiError("balance", "视频服务积分或余额不足", 402);
    }
    if (response.status === 429) {
      throw new VideoApiError("rate_limit", "视频服务请求过于频繁，请稍后重试", 429);
    }
    throw new VideoApiError(
      "upstream",
      "视频生成服务暂时不可用，请稍后重试",
      response.status >= 500 ? 502 : 400,
    );
  }

  try {
    return await response.json() as T;
  } catch {
    throw new VideoApiError("upstream", "视频服务响应格式异常，请重试", 502);
  }
}

export async function submitVideoTask(
  input: {
    prompt: string;
    ratio: string;
    durationSec: number;
    firstFrameUrl?: string;
    referenceImages?: string[];
    model?: string;
    resolution?: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const model = input.model ?? process.env.VIDEO_MODEL ?? DEFAULT_VIDEO_MODEL;
  if (
    Object.values(VIDEO_QUALITY_MODELS).includes(model as VideoQualityModel)
    && (input.durationSec < 5 || input.durationSec > 15)
  ) {
    throw new VideoApiError("invalid_request", "所选视频模型仅支持 5 到 15 秒", 400);
  }
  const body: Record<string, unknown> = {
    model,
    prompt: input.prompt,
    ratio: input.ratio,
    duration: input.durationSec,
    // Must match the pinned resolution of the configured model.
    resolution: input.resolution ?? process.env.VIDEO_RESOLUTION ?? "720p",
    generateAudio: true,
  };
  if (input.firstFrameUrl) body.firstFrame = input.firstFrameUrl;
  if (input.referenceImages?.length) body.referenceImages = input.referenceImages;

  const response = await jimengFetch<SubmitVideoResponse>(
    "/videos/generations",
    { method: "POST", body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) },
    fetchImpl,
  );
  const taskId = response.task_id ?? response.id;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new VideoApiError("upstream", "视频服务未返回任务编号，请重试", 502);
  }
  return taskId;
}

function extractResultUrl(response: TaskQueryResponse): string | undefined {
  for (const candidate of [response.result, response.result_url, response.video_url]) {
    if (typeof candidate === "string" && isHttpsUrl(candidate)) return candidate;
  }
  return undefined;
}

export async function getVideoTask(
  taskId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderVideoStatus> {
  const response = await jimengFetch<TaskQueryResponse>(
    `/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET", signal: AbortSignal.timeout(30_000) },
    fetchImpl,
  );
  const status = typeof response.status === "string" ? response.status : "";
  const progress = typeof response.progress === "number"
    ? Math.min(100, Math.max(0, response.progress))
    : 0;

  if (status === "completed" || status === "success") {
    const resultUrl = extractResultUrl(response);
    if (!resultUrl) throw new VideoApiError("upstream", "视频结果尚不可用，请继续查询", 502);
    return { status: "succeeded", resultUrl };
  }
  if (status === "failed" || status === "cancelled") {
    return { status: "failed", error: "视频生成失败，请重试" };
  }
  return { status: "running", progress };
}
