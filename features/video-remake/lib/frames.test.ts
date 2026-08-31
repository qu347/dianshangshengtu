import { afterEach, expect, it, vi } from "vitest";
import { extractVideoFrames, planSampleTimes, validateReferenceVideo } from "./frames";

it("plans midpoint samples inside the duration", () => {
  expect(planSampleTimes(10, 5)).toEqual([1, 3, 5, 7, 9]);
  expect(planSampleTimes(3, 6).every((time) => time >= 0 && time < 3)).toBe(true);
});

it("accepts supported video files and rejects others", () => {
  expect(validateReferenceVideo(new File(["x"], "a.mp4", { type: "video/mp4" }))).toBeNull();
  expect(validateReferenceVideo(new File(["x"], "a.webm", { type: "video/webm" }))).toBeNull();
  expect(validateReferenceVideo(new File(["x"], "a.mov", { type: "video/quicktime" })))
    .toContain("仅支持");
  expect(validateReferenceVideo(new File(["x"], "a.avi", { type: "video/x-msvideo" })))
    .toContain("仅支持");
  expect(validateReferenceVideo(new File([new Uint8Array(150 * 1024 * 1024 + 1)], "a.mp4", { type: "video/mp4" })))
    .toContain("150 MB");
});

it("rejects a decoded reference video longer than 90 seconds before extracting frames", async () => {
  const video = new EventTarget() as HTMLVideoElement;
  Object.defineProperties(video, {
    duration: { value: 90.01 },
    muted: { value: false, writable: true },
    preload: { value: "", writable: true },
    onloadedmetadata: { value: null, writable: true },
    onerror: { value: null, writable: true },
    src: {
      set: () => queueMicrotask(() => video.onloadedmetadata?.(new Event("loadedmetadata"))),
    },
  });
  Object.assign(video, {
    addEventListener: vi.fn(() => { throw new Error("frame extraction reached"); }),
    removeAttribute: vi.fn(),
    load: vi.fn(),
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:reference");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    if (tagName === "video") return video;
    throw new Error(`unexpected ${tagName} extraction`);
  }) as typeof document.createElement);

  await expect(extractVideoFrames(new File(["video"], "long.mp4", { type: "video/mp4" })))
    .rejects.toThrow("参考视频不能超过 90 秒");
});

afterEach(() => vi.restoreAllMocks());
