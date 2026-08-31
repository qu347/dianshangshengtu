import { expect, it } from "vitest";
import {
  SceneScriptSchema,
  VideoRemakeSettingsSchema,
  VideoSceneTaskSchema,
  VideoScriptSchema,
} from "./model";

const settings = { aspectRatio: "9:16", durationSec: 12, language: "zh-CN" };
const scene = { id: "1", title: "开镜", description: "商品特写推进", onScreenText: "96小时续航", durationSec: 12 };

it("accepts 5..30 second durations and the three ratios", () => {
  expect(VideoRemakeSettingsSchema.parse(settings).durationSec).toBe(12);
  expect(VideoRemakeSettingsSchema.parse({ ...settings, durationSec: 5 }).durationSec).toBe(5);
  expect(() => VideoRemakeSettingsSchema.parse({ ...settings, durationSec: 4 })).toThrow();
  expect(() => VideoRemakeSettingsSchema.parse({ ...settings, durationSec: 31 })).toThrow();
  expect(() => VideoRemakeSettingsSchema.parse({ ...settings, aspectRatio: "4:3" })).toThrow();
});

it("defaults the quality tier to 480p and rejects unknown tiers", () => {
  expect(VideoRemakeSettingsSchema.parse(settings).quality).toBe("480p");
  expect(() => VideoRemakeSettingsSchema.parse({ ...settings, quality: "1080p" })).toThrow();
});

it("requires the scene total to stay within four seconds of the request", () => {
  expect(() => VideoScriptSchema(12).parse({ styleNotes: "节奏快", scenes: [scene] })).not.toThrow();
  expect(() => VideoScriptSchema(12).parse({
    styleNotes: "节奏快",
    scenes: [{ ...scene, durationSec: 4 }],
  })).toThrow("分镜总时长");
});

it("forces scene ids to start at one and stay in order", () => {
  const twoScenes = { styleNotes: "节奏快", scenes: [scene, { ...scene, id: "2", durationSec: 6 }] };
  expect(() => VideoScriptSchema(18).parse(twoScenes)).not.toThrow();
  expect(() => VideoScriptSchema(18).parse({ ...twoScenes, scenes: [twoScenes.scenes[1], twoScenes.scenes[0]] })).toThrow("分镜序号");
});

it("binds each scene to the selected provider's 5..15 second range", () => {
  expect(SceneScriptSchema.parse({ ...scene, durationSec: 5 }).durationSec).toBe(5);
  expect(() => SceneScriptSchema.parse({ ...scene, durationSec: 4 })).toThrow();
  expect(() => SceneScriptSchema.parse({ ...scene, durationSec: 16 })).toThrow();
});

it("requires results and errors on terminal scene tasks", () => {
  expect(VideoSceneTaskSchema.safeParse({
    sceneId: "1", status: "succeeded", progress: 100, resultUrl: "https://cdn/clip.mp4", downloadToken: "t",
  }).success).toBe(true);
  expect(VideoSceneTaskSchema.safeParse({ sceneId: "1", status: "succeeded", progress: 100 }).success).toBe(false);
  expect(VideoSceneTaskSchema.safeParse({ sceneId: "1", status: "failed", progress: 0 }).success).toBe(false);
});
