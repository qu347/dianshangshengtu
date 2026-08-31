// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { signVideoJobToken, verifyClipToken, verifyMediaToken } from "@/lib/download-token";
import { getVideoTask } from "@/lib/jimeng/video";
import { GET } from "./route";

vi.mock("@/lib/jimeng/video", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/jimeng/video")>()),
  getVideoTask: vi.fn(),
}));

const secret = "test-secret";
const tokenInput = { providerTaskId: "provider-task-1", sceneId: "1", aspectRatio: "9:16", keyframeUrl: "https://cdn.example/kf.png" };

async function callGet(id: string) {
  return GET(new Request(`http://localhost/api/product-video/jobs/${encodeURIComponent(id)}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = secret;
  process.env.VIDEO_API_KEY = "video-key";
});

it("uses an image token for the succeeded keyframe and retains a clip token for the result", async () => {
  const token = signVideoJobToken(tokenInput, secret);
  vi.mocked(getVideoTask).mockResolvedValueOnce({ status: "succeeded", resultUrl: "https://cdn.example/clip.mp4" });

  const response = await callGet(token);
  const body = await response.json();

  expect(body.task).toMatchObject({ shotId: "1", providerJobId: token, status: "succeeded", progress: 100 });
  expect(verifyMediaToken(body.task.keyframeToken, secret)).toEqual({ kind: "keyframe", url: "https://cdn.example/kf.png" });
  expect(() => verifyClipToken(body.task.keyframeToken, secret)).toThrow("媒体令牌无效");
  expect(verifyClipToken(body.task.downloadToken, secret)).toEqual({ url: "https://cdn.example/clip.mp4" });
});
