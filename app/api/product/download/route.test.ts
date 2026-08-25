// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { verifyDownloadToken } from "@/lib/download-token";
import { GET } from "./route";

vi.mock("@/lib/download-token", () => ({ verifyDownloadToken: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
});

afterEach(() => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});

it("rejects an invalid token without fetching a URL", async () => {
  vi.mocked(verifyDownloadToken).mockImplementation(() => {
    throw new Error("下载令牌无效");
  });
  const fetchMock = vi.spyOn(globalThis, "fetch");

  const response = await GET(new Request("http://localhost/api/product/download?token=bad"));

  expect(response.status).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("downloads the signed image without following redirects", async () => {
  vi.mocked(verifyDownloadToken).mockReturnValue("https://cdn.example/result.png");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    }),
  );

  const response = await GET(new Request("http://localhost/api/product/download?token=good"));

  expect(fetchMock).toHaveBeenCalledWith(
    "https://cdn.example/result.png",
    expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) }),
  );
  expect(response.headers.get("Content-Disposition")).toBe("attachment; filename=\"result.png\"");
  expect(response.headers.get("Content-Type")).toBe("image/png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

it("refuses non-image upstream responses", async () => {
  vi.mocked(verifyDownloadToken).mockReturnValue("https://cdn.example/result.png");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("not an image", { status: 200, headers: { "Content-Type": "text/html" } }),
  );

  const response = await GET(new Request("http://localhost/api/product/download?token=good"));

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "图片下载失败，请稍后重试" });
});

it("returns 503 before token verification when the signing secret is absent", async () => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;

  const response = await GET(new Request("http://localhost/api/product/download?token=good"));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "图片下载服务尚未配置" });
  expect(verifyDownloadToken).not.toHaveBeenCalled();
});
