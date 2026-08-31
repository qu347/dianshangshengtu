import { z } from "zod";

export const IntroAspectSchema = z.enum(["9:16", "1:1", "16:9"]);
export const IntroLanguageSchema = z.enum(["zh-CN", "en", "ru"]);

export const VideoIntroSettingsSchema = z.object({
  aspectRatio: IntroAspectSchema,
  durationSec: z.number().int().min(5).max(30).default(10),
  // nd-seedance fixed-resolution tiers; the value picks the provider model.
  resolution: z.enum(["480p", "720p"]).default("480p"),
  language: IntroLanguageSchema,
});
export type VideoIntroSettings = z.infer<typeof VideoIntroSettingsSchema>;

export const ShotScriptSchema = z.object({
  id: z.string().trim().min(1).max(8),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(2000),
  onScreenText: z.string().trim().max(80).default(""),
  durationSec: z.number().int().min(5).max(15),
});
export type ShotScript = z.infer<typeof ShotScriptSchema>;

const canonicalShotId = (id: string, index: number) => id === String(index + 1);

export function IntroScriptSchema(durationSec: number) {
  return z.object({
    styleNotes: z.string().trim().min(1).max(2000),
    shots: z.array(ShotScriptSchema).min(1).max(6),
  }).superRefine((script, context) => {
    const total = script.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
    if (Math.abs(total - durationSec) > 4) {
      context.addIssue({
        code: "custom",
        path: ["shots"],
        message: `镜头总时长应约为 ${durationSec} 秒，实际为 ${total} 秒`,
      });
    }
    script.shots.forEach((shot, index) => {
      if (!canonicalShotId(shot.id, index)) {
        context.addIssue({ code: "custom", path: ["shots", index, "id"], message: "镜头序号必须从 1 连续排列" });
      }
    });
  });
}
export type IntroScript = z.infer<ReturnType<typeof IntroScriptSchema>>;

export const VideoIntroTaskSchema = z.object({
  shotId: z.string().min(1),
  providerJobId: z.string().min(1).optional(),
  status: z.enum(["queued", "submitting", "running", "succeeded", "failed"]),
  progress: z.number().min(0).max(100),
  keyframeUrl: z.string().url().optional(),
  keyframeToken: z.string().min(1).optional(),
  resultUrl: z.string().url().optional(),
  downloadToken: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
}).superRefine((task, context) => {
  if (task.status === "succeeded" && (!task.resultUrl || !task.downloadToken)) {
    context.addIssue({ code: "custom", message: "成功镜头必须包含结果地址和下载令牌" });
  }
  if (task.status === "failed" && !task.error) {
    context.addIssue({ code: "custom", message: "失败镜头必须包含错误说明" });
  }
});
export type VideoIntroTask = z.infer<typeof VideoIntroTaskSchema>;
