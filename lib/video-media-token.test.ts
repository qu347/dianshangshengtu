import { expect, it } from "vitest";
import { signClipUrl, signKeyframeUrl, verifyClipToken, verifyMediaToken } from "./download-token";

it("distinguishes signed keyframes from video clips", () => {
  const keyframe = signKeyframeUrl("https://cdn.example/keyframe.png", "secret", 100, 60);
  const clip = signClipUrl("https://cdn.example/clip.mp4", "secret", 100, 60);

  expect(verifyMediaToken(keyframe, "secret", 120)).toEqual({ kind: "keyframe", url: "https://cdn.example/keyframe.png" });
  expect(verifyMediaToken(clip, "secret", 120)).toEqual({ kind: "clip", url: "https://cdn.example/clip.mp4" });
  expect(() => verifyClipToken(keyframe, "secret", 120)).toThrow("媒体令牌无效");
});
