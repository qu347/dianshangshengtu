import { z } from "zod";

export const VideoAspectSchema = z.enum(["9:16", "1:1", "16:9"]);
export const VideoLanguageSchema = z.enum(["zh-CN", "en", "ru"]);

export const VideoQualitySchema = z.enum(["480p", "720p"]);

export const VideoRemakeSettingsSchema = z.object({
  aspectRatio: VideoAspectSchema,
  durationSec: z.number().int().min(5).max(30),
  language: VideoLanguageSchema,
  quality: VideoQualitySchema.default("480p"),
});
export type VideoRemakeSettings = z.infer<typeof VideoRemakeSettingsSchema>;

export const SceneScriptSchema = z.object({
  id: z.string().trim().min(1).max(8),
  title: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(2000),
  onScreenText: z.string().trim().max(80).default(""),
  durationSec: z.number().int().min(5).max(15),
});
export type SceneScript = z.infer<typeof SceneScriptSchema>;

const canonicalSceneId = (id: string, index: number) => id === String(index + 1);

export function VideoScriptSchema(durationSec: number) {
  return z.object({
    styleNotes: z.string().trim().min(1).max(2000),
    scenes: z.array(SceneScriptSchema).min(1).max(8),
  }).superRefine((script, context) => {
    const total = script.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
    if (Math.abs(total - durationSec) > 4) {
      context.addIssue({
        code: "custom",
        path: ["scenes"],
        message: `分镜总时长应约为 ${durationSec} 秒，实际为 ${total} 秒`,
      });
    }
    script.scenes.forEach((scene, index) => {
      if (!canonicalSceneId(scene.id, index)) {
        context.addIssue({ code: "custom", path: ["scenes", index, "id"], message: "分镜序号必须从 1 连续排列" });
      }
    });
  });
}
export type VideoScript = z.infer<ReturnType<typeof VideoScriptSchema>>;

export const VideoSceneTaskSchema = z.object({
  sceneId: z.string().min(1),
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
    context.addIssue({ code: "custom", message: "成功分镜必须包含结果地址和下载令牌" });
  }
  if (task.status === "failed" && !task.error) {
    context.addIssue({ code: "custom", message: "失败分镜必须包含错误说明" });
  }
});
export type VideoSceneTask = z.infer<typeof VideoSceneTaskSchema>;
