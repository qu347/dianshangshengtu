// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { signVideoJobToken, verifyClipToken, verifyMediaToken } from "@/lib/download-token";
import { getVideoTask, VideoApiError } from "@/lib/jimeng/video";
import { GET } from "./route";

vi.mock("@/lib/jimeng/video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/jimeng/video")>();
  return { ...actual, getVideoTask: vi.fn() };
});

const secret = "test-secret";
const tokenInput = {
  providerTaskId: "provider-task-1",
  sceneId: "1",
  aspectRatio: "9:16",
  keyframeUrl: "https://cdn.example/kf.png",
};

function jobToken() {
  return signVideoJobToken(tokenInput, secret);
}

async function callGet(id: string) {
  return GET(
    new Request(`http://localhost/api/video-remake/jobs/${encodeURIComponent(id)}`),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "grsai-key";
  process.env.DOWNLOAD_TOKEN_SECRET = secret;
  process.env.VIDEO_API_KEY = "video-key";
});

it("returns 503 before verification when secrets are missing", async () => {
  delete process.env.VIDEO_API_KEY;
  expect((await callGet(jobToken())).status).toBe(503);
  expect(getVideoTask).not.toHaveBeenCalled();
});

it("rejects an invalid job token before querying the provider", async () => {
  expect((await callGet("not-a-token")).status).toBe(400);
  expect(getVideoTask).not.toHaveBeenCalled();
});

it("passes a running task through with the same opaque token", async () => {
  const token = jobToken();
  vi.mocked(getVideoTask).mockResolvedValueOnce({ status: "running", progress: 40 });

  const response = await callGet(token);
  expect(getVideoTask).toHaveBeenCalledWith("provider-task-1");
  expect(await response.json()).toEqual({
    task: { sceneId: "1", providerJobId: token, status: "running", progress: 40 },
  });
});

it("signs same-origin preview and download urls for a succeeded task", async () => {
  const token = jobToken();
  vi.mocked(getVideoTask).mockResolvedValueOnce({ status: "succeeded", resultUrl: "https://cdn.example/clip.mp4" });

  const response = await callGet(token);
  const body = await response.json();

  expect(body.task).toMatchObject({ sceneId: "1", providerJobId: token, status: "succeeded", progress: 100 });
  const resultUrl = new URL(body.task.resultUrl);
  expect(resultUrl.origin).toBe("http://localhost");
  expect(resultUrl.pathname).toBe("/api/video-remake/download");
  expect(resultUrl.searchParams.get("inline")).toBe("1");
  expect(verifyClipToken(body.task.downloadToken, secret)).toEqual({ url: "https://cdn.example/clip.mp4" });
  expect(verifyMediaToken(body.task.keyframeToken, secret)).toEqual({ kind: "keyframe", url: "https://cdn.example/kf.png" });
  expect(() => verifyClipToken(body.task.keyframeToken, secret)).toThrow("媒体令牌无效");
});

it("maps a provider failure to a terminal failed task", async () => {
  vi.mocked(getVideoTask).mockResolvedValueOnce({ status: "failed", error: "视频生成失败，请重试" });

  const response = await callGet(jobToken());
  expect(await response.json()).toEqual({
    task: { sceneId: "1", providerJobId: expect.any(String), status: "failed", progress: 100, error: "视频生成失败，请重试" },
  });
});

it("maps upstream errors to their status", async () => {
  vi.mocked(getVideoTask).mockRejectedValueOnce(new VideoApiError("upstream", "视频生成服务暂时不可用，请稍后重试", 502));
  const response = await callGet(jobToken());
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "视频生成服务暂时不可用，请稍后重试" });
});
