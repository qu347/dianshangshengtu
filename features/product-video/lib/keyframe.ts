import { submitImageGeneration, getImageGenerationResult } from "@/lib/grsai/images";
import type { VideoIntroSettings } from "../model";

const KEYFRAME_ASPECT: Record<VideoIntroSettings["aspectRatio"], "1024x1024" | "1024x1536" | "1536x1024"> = {
  "9:16": "1024x1536",
  "1:1": "1024x1024",
  "16:9": "1536x1024",
};

export function keyframeAspect(ratio: VideoIntroSettings["aspectRatio"]) {
  return KEYFRAME_ASPECT[ratio];
}

// The video step needs a publicly reachable first frame, so the keyframe is
// fully resolved (provider result URL) before the video task is submitted.
export async function resolveKeyframeUrl(input: {
  images: string[];
  prompt: string;
  aspectRatio: VideoIntroSettings["aspectRatio"];
  fetchImpl?: typeof fetch;
  sleepMs?: number;
  attempts?: number;
}): Promise<string> {
  const sleepMs = input.sleepMs ?? 3000;
  const sleep = () => new Promise<void>((resolve) => setTimeout(resolve, sleepMs));
  const attempts = input.attempts ?? 12;

  const job = await submitImageGeneration({
    images: input.images,
    prompt: input.prompt,
    aspectRatio: keyframeAspect(input.aspectRatio),
    quality: "auto",
  }, input.fetchImpl);

  let current = job;
  for (let attempt = 0; attempt < attempts && current.status === "running"; attempt += 1) {
    await sleep();
    current = await getImageGenerationResult(current.id, input.fetchImpl);
  }
  const url = current.status === "succeeded" ? current.results[0]?.url : undefined;
  if (!url) throw new Error("关键帧生成失败，请重试此镜头");
  return url;
}
