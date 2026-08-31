import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { verifyClipToken } from "@/lib/download-token";
import { fetchPublicVideo } from "@/lib/remote-image";
import { validateProductPostRequest } from "@/lib/product-upload";

const execFileAsync = promisify(execFile);

const MAX_MERGE_CLIPS = 6;
const FFMPEG_TIMEOUT_MS = 10 * 60_000;
const FFMPEG_CONFIGURATION_ERROR = "视频合并服务配置无效：请检查 FFMPEG_PATH 或 PATH 中的 ffmpeg";

async function resolveFfmpegPath() {
  const configuredPath = process.env.FFMPEG_PATH;
  if (configuredPath) {
    try {
      if (!(await stat(configuredPath)).isFile()) return null;
    } catch {
      return null;
    }
  }

  const executable = configuredPath ?? "ffmpeg";
  try {
    await execFileAsync(executable, ["-version"], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    return executable;
  } catch {
    return null;
  }
}

// ffmpeg concat demuxer list: single quotes escaped ffmpeg-style.
function concatListEntry(filePath: string) {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export async function POST(request: Request) {
  const requestError = validateProductPostRequest(request);
  if (requestError) return requestError;

  const tokenSecret = process.env.DOWNLOAD_TOKEN_SECRET;
  if (!tokenSecret) {
    return Response.json({ error: "媒体下载服务尚未配置" }, { status: 503 });
  }

  let tokens: unknown;
  try {
    tokens = (await request.json()).tokens;
  } catch {
    return Response.json({ error: "合并参数无效" }, { status: 400 });
  }
  if (
    !Array.isArray(tokens)
    || tokens.length < 2
    || tokens.length > MAX_MERGE_CLIPS
    || tokens.some((token) => typeof token !== "string")
  ) {
    return Response.json({ error: "合并参数无效" }, { status: 400 });
  }

  let urls: string[];
  try {
    urls = tokens.map((token) => verifyClipToken(token as string, tokenSecret).url);
  } catch {
    return Response.json({ error: "媒体令牌无效或已过期" }, { status: 400 });
  }

  const executable = await resolveFfmpegPath();
  if (!executable) {
    return Response.json({ error: FFMPEG_CONFIGURATION_ERROR }, { status: 503 });
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "product-video-merge-"));
  try {
    const listLines: string[] = [];
    for (const [index, url] of urls.entries()) {
      const bytes = await fetchPublicVideo(url);
      const clipPath = path.join(workDir, `clip-${index}.mp4`);
      await writeFile(clipPath, bytes);
      listLines.push(concatListEntry(clipPath));
    }
    const listPath = path.join(workDir, "list.txt");
    await writeFile(listPath, `${listLines.join("\n")}\n`, "utf8");

    const outPath = path.join(workDir, "merged.mp4");
    const runFfmpeg = (extraArgs: string[]) => execFileAsync(executable, [
      "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0", "-i", listPath,
      ...extraArgs,
      "-movflags", "+faststart", "-y", outPath,
    ], { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 });

    // Same model + resolution clips share codec parameters, so lossless stream
    // copy is the normal path; re-encode only as a compatibility fallback.
    try {
      await runFfmpeg(["-c", "copy"]);
    } catch {
      await runFfmpeg(["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac"]);
    }

    const bytes = await readFile(outPath);
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Type": "video/mp4",
        "Content-Disposition": 'attachment; filename="product-video-merged.mp4"',
      },
    });
  } catch {
    return Response.json({ error: "视频合并失败，请稍后重试" }, { status: 502 });
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
