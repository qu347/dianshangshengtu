import { verifyDownloadToken } from "@/lib/download-token";
import type { ImageRenderConfig } from "@/lib/image-render-config";
import { renderProductImage } from "@/lib/product-image-renderer";

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_IMAGE_CONTENT_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
]);
const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};
const LEGACY_RENDER_CONFIG: ImageRenderConfig = {
  imageIndex: 1,
  annotations: [],
  watermark: "",
  applyWatermark: false,
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

export async function readImageResponse(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) throw new Error("图片响应为空");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("图片响应过大");
        throw new Error("图片响应过大");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), totalBytes);
}

export async function GET(request: Request) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!tokenSecret) return errorResponse("图片下载服务尚未配置", 503);

  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");
  if (!token) return errorResponse("下载令牌无效或已过期", 400);

  let resultUrl: string;
  let render: ImageRenderConfig;
  try {
    const verified = verifyDownloadToken(token, tokenSecret);
    if (typeof verified === "string") {
      resultUrl = verified;
      render = LEGACY_RENDER_CONFIG;
    } else {
      resultUrl = verified.url;
      render = verified.render;
    }
    if (new URL(resultUrl).protocol !== "https:") throw new Error("仅允许 HTTPS 图片地址");
  } catch {
    return errorResponse("下载令牌无效或已过期", 400);
  }

  try {
    const upstream = await fetch(resultUrl, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = upstream.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
    if (!upstream.ok || !contentType || !SUPPORTED_IMAGE_CONTENT_TYPES.has(contentType)) {
      await upstream.body?.cancel();
      return errorResponse("图片下载失败，请稍后重试", 502);
    }
    if (!upstream.body) {
      return errorResponse("图片下载失败，请稍后重试", 502);
    }

    const input = await readImageResponse(upstream, MAX_IMAGE_BYTES);
    const output = await renderProductImage(input, render);
    const disposition = requestUrl.searchParams.get("inline") === "1" ? "inline" : "attachment";

    return new Response(new Uint8Array(output), {
      status: 200,
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Disposition": `${disposition}; filename="${downloadFilename(resultUrl)}"`,
        "Content-Type": "image/png",
      },
    });
  } catch {
    return errorResponse("图片下载失败，请稍后重试", 502);
  }
}
