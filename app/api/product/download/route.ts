import { verifyDownloadToken } from "@/lib/download-token";

const filenameFallbacks: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function downloadFilename(url: string, contentType: string) {
  const pathname = new URL(url).pathname;
  let candidate = pathname.split("/").pop() ?? "";
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    candidate = "";
  }
  candidate = candidate.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  if (!candidate || candidate === "." || candidate === "..") {
    candidate = `generated-image.${filenameFallbacks[contentType] ?? "img"}`;
  }
  return candidate;
}

export async function GET(request: Request) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "图片下载服务尚未配置" }, { status: 503 });
  }

  const token = new URL(request.url).searchParams.get("token");
  if (!token) return Response.json({ error: "下载令牌无效或已过期" }, { status: 400 });

  let resultUrl: string;
  try {
    resultUrl = verifyDownloadToken(token, tokenSecret);
  } catch {
    return Response.json({ error: "下载令牌无效或已过期" }, { status: 400 });
  }

  try {
    const upstream = await fetch(resultUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = upstream.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (!upstream.ok || !upstream.body || !contentType?.startsWith("image/")) {
      return Response.json({ error: "图片下载失败，请稍后重试" }, { status: 502 });
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${downloadFilename(resultUrl, contentType)}"`,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "图片下载失败，请稍后重试" }, { status: 502 });
  }
}
