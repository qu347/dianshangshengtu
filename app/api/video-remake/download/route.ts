import { verifyClipToken } from "@/lib/download-token";
import { fetchPublicVideo } from "@/lib/remote-image";

const RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "媒体下载服务尚未配置" }, { status: 503, headers: RESPONSE_HEADERS });
  }

  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token");
  if (!token) {
    return Response.json({ error: "媒体令牌无效或已过期" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  let verified: ReturnType<typeof verifyClipToken>;
  try {
    verified = verifyClipToken(token, tokenSecret);
  } catch {
    return Response.json({ error: "媒体令牌无效或已过期" }, { status: 400, headers: RESPONSE_HEADERS });
  }

  try {
    const bytes = await fetchPublicVideo(verified.url);
    const disposition = requestUrl.searchParams.get("inline") === "1" ? "inline" : "attachment";
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...RESPONSE_HEADERS,
        "Content-Disposition": `${disposition}; filename="video-clip.mp4"`,
        "Content-Type": "video/mp4",
      },
    });
  } catch {
    return Response.json({ error: "视频下载失败，请稍后重试" }, { status: 502, headers: RESPONSE_HEADERS });
  }
}
