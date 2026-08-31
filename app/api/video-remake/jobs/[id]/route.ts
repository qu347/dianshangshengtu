import { verifyVideoJobToken, signClipUrl } from "@/lib/download-token";
import { clipDownloadUrl } from "@/features/video-remake/lib/urls";
import { VideoApiError, getVideoTask } from "@/lib/jimeng/video";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!tokenSecret || !process.env.VIDEO_API_KEY) {
    return Response.json({ error: "视频生成服务尚未配置" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!id) return Response.json({ error: "视频任务令牌无效" }, { status: 400 });

  let verified: ReturnType<typeof verifyVideoJobToken>;
  try {
    verified = verifyVideoJobToken(id, tokenSecret);
  } catch {
    return Response.json({ error: "视频任务令牌无效" }, { status: 400 });
  }

  try {
    const status = await getVideoTask(verified.providerTaskId);
    if (status.status === "running") {
      return Response.json({
        task: {
          sceneId: verified.sceneId,
          providerJobId: id,
          status: "running",
          progress: status.progress,
        },
      });
    }
    if (status.status === "failed") {
      return Response.json({
        task: {
          sceneId: verified.sceneId,
          providerJobId: id,
          status: "failed",
          progress: 100,
          error: status.error,
        },
      });
    }
    const keyframeToken = signClipUrl(verified.keyframeUrl, tokenSecret);
    const downloadToken = signClipUrl(status.resultUrl, tokenSecret);
    return Response.json({
      task: {
        sceneId: verified.sceneId,
        providerJobId: id,
        status: "succeeded",
        progress: 100,
        keyframeUrl: clipDownloadUrl(request.url, keyframeToken, true),
        keyframeToken,
        resultUrl: clipDownloadUrl(request.url, downloadToken, true),
        downloadToken,
      },
    });
  } catch (error) {
    if (error instanceof VideoApiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "获取视频任务结果失败，请稍后重试" }, { status: 500 });
  }
}
