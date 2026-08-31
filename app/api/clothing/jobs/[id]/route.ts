import { signDownloadUrl, verifyJobToken } from "@/lib/download-token";
import { GrsaiError } from "@/lib/grsai/errors";
import { getImageGenerationResult } from "@/lib/grsai/images";
import { prepareGeneratedImageResult } from "@/lib/product-image-result";

type RouteContext = { params: Promise<{ id: string }> };

function inlineResultUrl(requestUrl: string, token: string) {
  const url = new URL("/api/clothing/download", requestUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("inline", "1");
  return url.toString();
}
export async function GET(request: Request, context: RouteContext) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!process.env.GRSAI_API_KEY || !tokenSecret) {
    return Response.json({ error: "图片生成服务尚未配置" }, { status: 503 });
  }
  const { id } = await context.params;
  if (!id) return Response.json({ error: "任务编号无效" }, { status: 400 });

  let verified: ReturnType<typeof verifyJobToken>;
  try {
    verified = verifyJobToken(id, tokenSecret);
  } catch {
    return Response.json({ error: "任务编号无效" }, { status: 400 });
  }

  try {
    const job = await getImageGenerationResult(verified.providerJobId);
    const result = job.status === "succeeded" ? job.results[0] : undefined;
    if (job.status === "succeeded" && !result) {
      throw new GrsaiError("upstream", "图片生成结果尚不可用，请继续查询", 502);
    }
    const prepared = result
      ? await prepareGeneratedImageResult({ url: result.url, render: verified.render })
      : { ok: true as const, render: verified.render };
    if (!prepared.ok) {
      return Response.json({
        task: {
          providerJobId: id,
          status: "failed",
          progress: job.progress,
          error: prepared.error,
        },
      });
    }
    if (!result) {
      return Response.json({
        task: {
          providerJobId: id,
          status: job.status,
          progress: job.progress,
          ...(job.error ? { error: job.error } : {}),
        },
      });
    }
    const ttlSeconds = verified.render.imageIndex === 99 ? 2 * 60 * 60 : undefined;
    const downloadToken = signDownloadUrl(
      result.url,
      prepared.render,
      tokenSecret,
      undefined,
      ttlSeconds,
    );
    return Response.json({
      task: {
        providerJobId: id,
        status: "succeeded",
        progress: job.progress,
        resultUrl: inlineResultUrl(request.url, downloadToken),
        downloadToken,
      },
    });
  } catch (error) {
    if (error instanceof GrsaiError && error.code === "moderation") {
      return Response.json({
        task: { providerJobId: id, status: "failed", progress: 0, error: "图片未通过内容审核" },
      });
    }
    if (error instanceof GrsaiError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "获取图片生成结果失败，请稍后重试" }, { status: 500 });
  }
}
