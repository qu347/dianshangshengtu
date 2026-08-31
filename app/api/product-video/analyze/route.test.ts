// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { analyzeIntroScript } from "@/features/product-video/lib/script";
import { GrsaiError } from "@/lib/grsai/errors";
import { POST } from "./route";

vi.mock("@/features/product-video/lib/script", () => ({ analyzeIntroScript: vi.fn(), buildIntroScriptPrompt: vi.fn(() => "prompt") }));

const script = {
  styleNotes: "黑金质感背景，大字卖点叠层",
  shots: [{ id: "1", title: "开镜特写", description: "商品居中特写，缓慢推进", onScreenText: "96小时超长续航", durationSec: 10 }],
};
const settings = { aspectRatio: "9:16", durationSec: 10, resolution: "480p", language: "zh-CN" };
const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

function analyzeForm(options: { imageCount?: number; imageType?: string; imageBytes?: BlobPart; settings?: unknown } = {}) {
  const form = new FormData();
  const imageCount = options.imageCount ?? 1;
  for (let index = 0; index < imageCount; index += 1) {
    form.append("images", new File([options.imageBytes ?? webpBytes], `${index}.webp`, { type: options.imageType ?? "image/webp" }));
  }
  form.append("productName", "无线蓝牙耳机");
  form.append("requirements", "突出续航");
  form.append("settings", JSON.stringify(options.settings ?? settings));
  return form;
}

function analyzeRequest(form = analyzeForm(), headers: HeadersInit = { "X-Product-Studio-Request": "1" }) {
  return new Request("http://localhost/api/product-video/analyze", { method: "POST", body: form, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("rejects a request without the private browser header", async () => {
  const response = await POST(analyzeRequest(analyzeForm(), {}));

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "请求来源无效" });
  expect(analyzeIntroScript).not.toHaveBeenCalled();
});

it("rejects a declared body beyond the 36 MB limit before parsing", async () => {
  const request = new Request("http://localhost/api/product-video/analyze", {
    method: "POST",
    body: analyzeForm(),
    headers: { "X-Product-Studio-Request": "1", "Content-Length": String(36 * 1024 * 1024 + 1) },
  });
  const response = await POST(request);

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "请求体不能超过 36 MB" });
  expect(analyzeIntroScript).not.toHaveBeenCalled();
});

it("rejects zero, seven, or non-image uploads", async () => {
  expect((await POST(analyzeRequest(analyzeForm({ imageCount: 0 })))).status).toBe(400);
  expect((await POST(analyzeRequest(analyzeForm({ imageCount: 7 })))).status).toBe(400);
  expect((await POST(analyzeRequest(analyzeForm({ imageType: "image/gif" })))).status).toBe(400);
  const textBytes = new Uint8Array(12).fill(0x41);
  expect((await POST(analyzeRequest(analyzeForm({ imageBytes: textBytes })))).status).toBe(400);
  expect(analyzeIntroScript).not.toHaveBeenCalled();
});

it("rejects invalid settings", async () => {
  const response = await POST(analyzeRequest(analyzeForm({ settings: { ...settings, durationSec: 60 } })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "生成设置无效" });
});

it("returns the analyzed script with product context", async () => {
  vi.mocked(analyzeIntroScript).mockResolvedValueOnce(script);
  const response = await POST(analyzeRequest());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ script });
  expect(analyzeIntroScript).toHaveBeenCalledWith(expect.objectContaining({
    settings,
    productName: "无线蓝牙耳机",
    requirements: "突出续航",
    images: [expect.stringMatching(/^data:image\/webp;base64,/)],
  }));
});

it("truncates oversized free-text fields", async () => {
  vi.mocked(analyzeIntroScript).mockResolvedValueOnce(script);
  const form = analyzeForm();
  form.set("requirements", "卖".repeat(5000));
  await POST(analyzeRequest(form));

  expect(vi.mocked(analyzeIntroScript).mock.calls[0][0].requirements).toHaveLength(2000);
});

it("maps Grsai errors to their status", async () => {
  vi.mocked(analyzeIntroScript).mockRejectedValueOnce(new GrsaiError("invalid_request", "分镜脚本格式异常，请重新分析", 502));
  const response = await POST(analyzeRequest());

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "分镜脚本格式异常，请重新分析" });
});
