import {
  SceneScript,
  VideoRemakeSettings,
  VideoSceneTaskSchema,
  VideoScriptSchema,
  type VideoSceneTask,
  type VideoScript,
} from "../model";
import { productRequestHeaders } from "@/lib/product-upload";

export class VideoRemakeApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "VideoRemakeApiError";
    this.retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

export async function analyzeScriptClient(input: {
  frameFiles: File[];
  videoDurationSec: number;
  productName: string;
  requirements: string;
  settings: VideoRemakeSettings;
}): Promise<VideoScript> {
  const form = new FormData();
  input.frameFiles.forEach((file) => form.append("frames", file));
  form.append("videoDurationSec", String(input.videoDurationSec));
  form.append("productName", input.productName);
  form.append("requirements", input.requirements);
  form.append("settings", JSON.stringify(input.settings));

  const response = await fetch("/api/video-remake/analyze", {
    method: "POST",
    body: form,
    headers: productRequestHeaders,
  });
  const body = await response.json();
  if (!response.ok) throw new VideoRemakeApiError(body.error ?? "分析失败，请稍后重试", response.status);

  return VideoScriptSchema(input.settings.durationSec).parse(body.script);
}

export async function submitSceneClient(input: {
  productImages: File[];
  modelImage: File | null;
  scene: SceneScript;
  settings: VideoRemakeSettings;
}): Promise<VideoSceneTask> {
  const form = new FormData();
  input.productImages.forEach((file) => form.append("images", file));
  if (input.modelImage) form.append("modelImage", input.modelImage);
  form.append("scene", JSON.stringify(input.scene));
  form.append("settings", JSON.stringify(input.settings));

  const response = await fetch("/api/video-remake/generate", {
    method: "POST",
    body: form,
    headers: productRequestHeaders,
  });
  const body = await response.json();
  if (!response.ok) throw new VideoRemakeApiError(body.error ?? "提交视频任务失败", response.status);

  return VideoSceneTaskSchema.parse(body.task);
}

export async function getSceneStatusClient(jobToken: string, sceneId: string): Promise<VideoSceneTask> {
  const response = await fetch(`/api/video-remake/jobs/${encodeURIComponent(jobToken)}`, {
    headers: productRequestHeaders,
  });
  const body = await response.json();
  if (!response.ok) throw new VideoRemakeApiError(body.error ?? "查询视频任务失败", response.status);

  return VideoSceneTaskSchema.parse({ ...body.task, sceneId });
}

export async function fetchClipBlob(token: string) {
  const response = await fetch(`/api/video-remake/download?token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("视频下载失败，请重试");
  return response.blob();
}
