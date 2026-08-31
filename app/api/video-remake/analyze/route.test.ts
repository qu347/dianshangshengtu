// @vitest-environment node

import sharp from "sharp";
import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { analyzeVideoScript } from "@/lib/grsai/video-script";
import { GrsaiError } from "@/lib/grsai/errors";
import { POST } from "./route";

vi.mock("@/lib/grsai/video-script", () => ({ analyzeVideoScript: vi.fn(), languageDisplayName: vi.fn(() => "中文") }));

const script = {
  styleNotes: "黑金背景",
  scenes: [{ id: "1", title: "开镜", description: "商品特写", onScreenText: "大促", durationSec: 10 }],
};
const settings = { aspectRatio: "9:16", durationSec: 10, language: "zh-CN", quality: "480p" };
let validJpeg: Buffer;

beforeAll(async () => {
  validJpeg = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#eeeeee" },
  }).jpeg().toBuffer();
});

function analyzeForm() {
  const form = new FormData();
  form.append("frames", new File([Uint8Array.from(validJpeg)], "f.jpg", { type: "image/jpeg" }));
  form.append("videoDurationSec", "15");
  form.append("productName", "无线耳机");
  form.append("requirements", "");
  form.append("settings", JSON.stringify(settings));
  return form;
}

function analyzeRequest() {
  return new Request("http://localhost/api/video-remake/analyze", {
    method: "POST",
    body: analyzeForm(),
    headers: { "X-Product-Studio-Request": "1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("rejects a request without the private browser header", async () => {
  const request = new Request("http://localhost/api/video-remake/analyze", {
    method: "POST",
    body: analyzeForm(),
  });
  const response = await POST(request);

  expect(response.status).toBe(403);
  expect(analyzeVideoScript).not.toHaveBeenCalled();
});

it("rejects missing or oversized frames", async () => {
  const empty = new Request("http://localhost/api/video-remake/analyze", {
    method: "POST",
    body: (() => { const form = new FormData(); form.append("settings", JSON.stringify(settings)); return form; })(),
    headers: { "X-Product-Studio-Request": "1" },
  });
  expect((await POST(empty)).status).toBe(400);

  const form = analyzeForm();
  form.append("frames", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }));
  const oversized = new Request("http://localhost/api/video-remake/analyze", {
    method: "POST",
    body: form,
    headers: { "X-Product-Studio-Request": "1" },
  });
  expect((await POST(oversized)).status).toBe(400);
});

it("rejects a 91-second reference duration before analysis", async () => {
  const form = analyzeForm();
  form.set("videoDurationSec", "91");
  const response = await POST(new Request("http://localhost/api/video-remake/analyze", {
    method: "POST",
    body: form,
    headers: { "X-Product-Studio-Request": "1" },
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "参考视频时长无效" });
  expect(analyzeVideoScript).not.toHaveBeenCalled();
});

it("rejects a JPEG MIME frame whose bytes cannot be decoded", async () => {
  const form = analyzeForm();
  form.set("frames", new File([new Uint8Array([0xff, 0xd8, 0xff])], "broken.jpg", { type: "image/jpeg" }));
  const response = await POST(new Request("http://localhost/api/video-remake/analyze", {
    method: "POST",
    body: form,
    headers: { "X-Product-Studio-Request": "1" },
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "图片格式或大小不符合要求" });
  expect(analyzeVideoScript).not.toHaveBeenCalled();
});

it("rejects invalid settings", async () => {
  const form = analyzeForm();
  form.set("settings", JSON.stringify({ ...settings, durationSec: 60 }));
  const response = await POST(new Request("http://localhost/api/video-remake/analyze", {
    method: "POST",
    body: form,
    headers: { "X-Product-Studio-Request": "1" },
  }));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "生成设置无效" });
});

it("returns the analyzed script", async () => {
  vi.mocked(analyzeVideoScript).mockResolvedValueOnce(script);
  const response = await POST(analyzeRequest());

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ script });
  expect(analyzeVideoScript).toHaveBeenCalledWith(expect.objectContaining({
    settings,
    productName: "无线耳机",
    videoDurationSec: 15,
  }));
});

it("maps Grsai errors to their status", async () => {
  vi.mocked(analyzeVideoScript).mockRejectedValueOnce(new GrsaiError("invalid_request", "分镜脚本格式异常，请重新分析", 502));
  const response = await POST(analyzeRequest());

  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "分镜脚本格式异常，请重新分析" });
});
