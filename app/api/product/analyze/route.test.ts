// @vitest-environment node

import { beforeEach, expect, it, vi } from "vitest";
import { analysisWithTwoItems } from "@/features/product-studio/test-fixtures";
import { analyzeProduct } from "@/lib/grsai/analysis";
import { POST } from "./route";

vi.mock("@/lib/grsai/analysis", () => ({ analyzeProduct: vi.fn() }));

const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpegSignature = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const requestHeaders = { "X-Product-Studio-Request": "1" };
const validSettings = {
  platform: "taobao",
  language: "zh-CN",
  aspectRatio: "1024x1536",
  imageCount: 4,
  quality: "auto",
  watermark: "",
};
const validDimensions = [{ id: "height", label: "杯高", value: 12, unit: "cm" }];

function analysisForm(options: {
  imageCount?: number;
  imageBytes?: BlobPart;
  imageType?: string;
  settings?: unknown;
  dimensions?: unknown;
} = {}) {
  const form = new FormData();
  const imageCount = options.imageCount ?? 1;
  for (let index = 0; index < imageCount; index += 1) {
    form.append("images", new File(
      [options.imageBytes ?? pngSignature],
      `${index}.png`,
      { type: options.imageType ?? "image/png" },
    ));
  }
  form.append("settings", JSON.stringify(options.settings ?? validSettings));
  if (options.dimensions !== null) {
    form.append("dimensions", JSON.stringify(options.dimensions ?? validDimensions));
  }
  return form;
}

function analysisRequest(form: FormData, headers: HeadersInit = requestHeaders) {
  return new Request("http://localhost/api/product/analyze", { method: "POST", body: form, headers });
}

beforeEach(() => {
  vi.resetAllMocks();
});

it("rejects a request without the private browser header before parsing multipart data", async () => {
  const request = analysisRequest(analysisForm(), {});
  const formDataSpy = vi.spyOn(request, "formData");

  const response = await POST(request);

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "请求来源无效" });
  expect(formDataSpy).not.toHaveBeenCalled();
  expect(analyzeProduct).not.toHaveBeenCalled();
});

it("rejects an oversized declared body before parsing multipart data", async () => {
  const request = analysisRequest(analysisForm(), {
    ...requestHeaders,
    "Content-Length": String(36 * 1024 * 1024 + 1),
  });
  const formDataSpy = vi.spyOn(request, "formData");

  const response = await POST(request);

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "请求体不能超过 36 MB" });
  expect(formDataSpy).not.toHaveBeenCalled();
  expect(analyzeProduct).not.toHaveBeenCalled();
});

it("rejects more than six images before calling Grsai", async () => {
  const response = await POST(analysisRequest(analysisForm({ imageCount: 7 })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "最多上传 6 张产品图" });
  expect(analyzeProduct).not.toHaveBeenCalled();
});

it.each([
  ["an unsupported MIME type", { imageType: "image/gif", imageBytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]) }],
  ["a file larger than 5 MB", { imageBytes: new Uint8Array(5 * 1024 * 1024 + 1) }],
  ["spoofed PNG bytes", { imageBytes: new TextEncoder().encode("not a png") }],
] as const)("rejects %s at the upload boundary", async (_label, options) => {
  if (options.imageBytes.byteLength > 5 * 1024 * 1024) {
    options.imageBytes.set(pngSignature, 0);
  }

  const response = await POST(analysisRequest(analysisForm(options)));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "图片格式或大小不符合要求" });
  expect(analyzeProduct).not.toHaveBeenCalled();
});

it("rejects invalid settings at the untrusted route boundary", async () => {
  const response = await POST(analysisRequest(analysisForm({
    settings: { ...validSettings, imageCount: 0 },
  })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "生成参数无效" });
  expect(analyzeProduct).not.toHaveBeenCalled();
});

it("rejects missing dimensions for a multi-image analysis", async () => {
  const response = await POST(analysisRequest(analysisForm({
    settings: { ...validSettings, imageCount: 2 },
    dimensions: null,
  })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "产品尺寸无效" });
  expect(analyzeProduct).not.toHaveBeenCalled();
});

it("accepts no dimensions when the dimension image is disabled", async () => {
  vi.mocked(analyzeProduct).mockResolvedValueOnce(analysisWithTwoItems);

  const response = await POST(analysisRequest(analysisForm({
    settings: { ...validSettings, imageCount: 2, generateDimensionImage: false },
    dimensions: null,
  })));

  expect(response.status).toBe(200);
  expect(analyzeProduct).toHaveBeenCalledWith(expect.objectContaining({
    settings: expect.objectContaining({ generateDimensionImage: false }),
    dimensions: [],
  }));
});

it("accepts a JPEG whose bytes contain the JPEG magic signature", async () => {
  vi.mocked(analyzeProduct).mockResolvedValueOnce(analysisWithTwoItems);

  const response = await POST(analysisRequest(analysisForm({
    imageBytes: jpegSignature,
    imageType: "image/jpeg",
  })));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ analysis: analysisWithTwoItems });
  expect(analyzeProduct).toHaveBeenCalledWith(expect.objectContaining({ dimensions: validDimensions }));
});

it("does not treat an upstream SyntaxError as invalid generation settings", async () => {
  vi.mocked(analyzeProduct).mockRejectedValueOnce(new SyntaxError("upstream body was invalid"));

  const response = await POST(analysisRequest(analysisForm()));

  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "分析失败，请稍后重试" });
});
