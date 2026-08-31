import { verifyDownloadToken } from "@/lib/download-token";
import { renderProductImage } from "@/lib/product-image-renderer";
import { fetchPublicImage } from "@/lib/remote-image";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

function downloadFilename(url: string) {
  const pathname = new URL(url).pathname;
  let candidate = pathname.split("/").pop() ?? "";
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    candidate = "";
  }
  candidate = candidate.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const extensionIndex = candidate.lastIndexOf(".");
  if (extensionIndex > 0) candidate = candidate.slice(0, extensionIndex);
  if (!candidate || candidate === "." || candidate === "..") candidate = "generated-image";
  return `${candidate}.png`;
}
function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status, headers: RESPONSE_HEADERS });
}
export async function GET(request: Request) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!tokenSecret) return errorResponse("图片下载服务尚未配置", 503);
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");
  if (!token) return errorResponse("下载令牌无效或已过期", 400);

  let verified: ReturnType<typeof verifyDownloadToken>;
  try {
    verified = verifyDownloadToken(token, tokenSecret);
  } catch {
    return errorResponse("下载令牌无效或已过期", 400);
  }

  try {
    const input = await fetchPublicImage(verified.url);
    const output = await renderProductImage(input, verified.render);
    const disposition = requestUrl.searchParams.get("inline") === "1" ? "inline" : "attachment";
    return new Response(new Uint8Array(output), {
      status: 200,
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Disposition": `${disposition}; filename="${downloadFilename(verified.url)}"`,
        "Content-Type": "image/png",
      },
    });
  } catch {
    return errorResponse("图片下载失败，请稍后重试", 502);
  }
}
