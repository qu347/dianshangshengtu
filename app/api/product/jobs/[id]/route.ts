import { signDownloadUrl } from "@/lib/download-token";
import { GrsaiError } from "@/lib/grsai/errors";
import { getImageGenerationResult } from "@/lib/grsai/images";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!process.env.GRSAI_API_KEY || !tokenSecret) {
    return Response.json({ error: "图片生成服务尚未配置" }, { status: 503 });
  }

  const { id } = await context.params;
  if (!id) return Response.json({ error: "任务编号无效" }, { status: 400 });

  try {
    const job = await getImageGenerationResult(id);
    const result = job.status === "succeeded" ? job.results[0] : undefined;
    const signedResult = result
      ? {
          resultUrl: result.url,
          downloadToken: signDownloadUrl(result.url, tokenSecret),
        }
      : {};

    return Response.json({
      task: {
        providerJobId: job.id,
        status: job.status,
        progress: job.progress,
        ...signedResult,
        ...(job.error ? { error: job.error } : {}),
      },
    });
  } catch (error) {
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "获取图片生成结果失败，请稍后重试" }, { status: 500 });
  }
}
