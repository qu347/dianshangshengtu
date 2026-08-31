import { expect, it } from "vitest";
import {
  ShotScriptSchema,
  VideoIntroSettingsSchema,
  VideoIntroTaskSchema,
  IntroScriptSchema,
} from "./model";

const settings = { aspectRatio: "9:16", durationSec: 10, language: "zh-CN" };
const shot = { id: "1", title: "开镜特写", description: "黑金背景商品特写，缓慢推进", onScreenText: "96小时超长续航", durationSec: 10 };

it("defaults to 10 seconds and binds the total to 5..30", () => {
  expect(VideoIntroSettingsSchema.parse({ aspectRatio: "1:1", language: "en" })).toMatchObject({ durationSec: 10, resolution: "480p" });
  expect(() => VideoIntroSettingsSchema.parse({ ...settings, durationSec: 4 })).toThrow();
  expect(() => VideoIntroSettingsSchema.parse({ ...settings, durationSec: 31 })).toThrow();
  expect(() => VideoIntroSettingsSchema.parse({ ...settings, durationSec: 10.5 })).toThrow();
  expect(() => VideoIntroSettingsSchema.parse({ ...settings, aspectRatio: "4:3" })).toThrow();
  expect(() => VideoIntroSettingsSchema.parse({ ...settings, language: "fr" })).toThrow();
  expect(() => VideoIntroSettingsSchema.parse({ ...settings, resolution: "1080p" })).toThrow();
  expect(VideoIntroSettingsSchema.parse({ ...settings, resolution: "720p" }).resolution).toBe("720p");
});

it("requires the shot total to stay within four seconds of the request", () => {
  expect(() => IntroScriptSchema(10).parse({ styleNotes: "黑金质感", shots: [shot] })).not.toThrow();
  expect(() => IntroScriptSchema(10).parse({
    styleNotes: "黑金质感",
    shots: [{ ...shot, durationSec: 4 }],
  })).toThrow("镜头总时长");
  expect(() => IntroScriptSchema(30).parse({ styleNotes: "黑金质感", shots: [shot, { ...shot, id: "2", durationSec: 10 }, { ...shot, id: "3", durationSec: 10 }] })).not.toThrow();
});

it("keeps one to six shots with sequential ids", () => {
  const shots = [1, 2, 3, 4, 5, 6].map((index) => ({ ...shot, id: String(index), durationSec: 5 }));
  expect(() => IntroScriptSchema(30).parse({ styleNotes: "黑金质感", shots })).not.toThrow();
  expect(() => IntroScriptSchema(30).parse({ styleNotes: "黑金质感", shots: [...shots, { ...shot, id: "7" }] })).toThrow();
  expect(() => IntroScriptSchema(10).parse({ styleNotes: "黑金质感", shots: [{ ...shot, id: "2" }] })).toThrow("镜头序号");
});

it("binds each shot to 5..15 seconds", () => {
  expect(() => ShotScriptSchema.parse({ ...shot, durationSec: 4 })).toThrow();
  expect(() => ShotScriptSchema.parse({ ...shot, durationSec: 16 })).toThrow();
  expect(ShotScriptSchema.parse({ ...shot, durationSec: 5 }).durationSec).toBe(5);
});

it("requires results and errors on terminal shot tasks", () => {
  expect(VideoIntroTaskSchema.safeParse({
    shotId: "1", status: "succeeded", progress: 100, resultUrl: "https://cdn/clip.mp4", downloadToken: "t",
  }).success).toBe(true);
  expect(VideoIntroTaskSchema.safeParse({ shotId: "1", status: "succeeded", progress: 100 }).success).toBe(false);
  expect(VideoIntroTaskSchema.safeParse({ shotId: "1", status: "failed", progress: 0 }).success).toBe(false);
  expect(VideoIntroTaskSchema.safeParse({ shotId: "1", status: "failed", progress: 0, error: "超时" }).success).toBe(true);
});
