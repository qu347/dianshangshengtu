const ACCEPTED_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 90;
const MAX_FRAME_EDGE = 1280;

export function validateReferenceVideo(file: File): string | null {
  if (!ACCEPTED_VIDEO_TYPES.has(file.type)) return "仅支持 MP4、WEBM 参考视频";
  if (file.size > MAX_VIDEO_BYTES) return "参考视频不能超过 150 MB";
  return null;
}

export function planSampleTimes(durationSec: number, count: number): number[] {
  const safeDuration = Math.max(0.1, durationSec);
  return Array.from({ length: count }, (_, index) => {
    const midpoint = ((index + 0.5) / count) * safeDuration;
    return Math.min(safeDuration - 0.05, Math.max(0, midpoint));
  });
}

async function seekTo(video: HTMLVideoElement, timeSec: number) {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("视频抽帧超时")), 5_000);
    const onSeeked = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      resolve();
    };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = timeSec;
  });
}

function canvasToJpeg(video: HTMLVideoElement): Promise<File> {
  const scale = Math.min(1, MAX_FRAME_EDGE / Math.max(video.videoWidth, video.videoHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理视频画面");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(new File([blob], "frame.jpg", { type: "image/jpeg" }))
        : reject(new Error("视频画面提取失败")),
      "image/jpeg",
      0.85,
    );
  });
}

// The reference video never leaves the browser: only the extracted frames are
// uploaded to the analyze endpoint.
export async function extractVideoFrames(
  file: File,
  count = 6,
): Promise<Array<{ file: File; atSec: number }>> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("视频读取超时")), 15_000);
      video.onloadedmetadata = () => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timer);
        reject(new Error("无法解码该参考视频"));
      };
    });

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (!duration) throw new Error("无法读取参考视频时长");
    if (duration > MAX_VIDEO_SECONDS) throw new Error("参考视频不能超过 90 秒");

    const frames: Array<{ file: File; atSec: number }> = [];
    let index = 0;
    for (const atSec of planSampleTimes(duration, count)) {
      await seekTo(video, atSec);
      frames.push({
        file: new File([await canvasToJpeg(video)], `frame-${index + 1}.jpg`, { type: "image/jpeg" }),
        atSec: Math.round(atSec * 10) / 10,
      });
      index += 1;
    }
    return frames;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
