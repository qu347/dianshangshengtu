// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { analysisWithTwoItems, defaultSettings, makePlanItems } from "@/features/product-studio/test-fixtures";
import { signDownloadUrl, verifyDownloadToken, verifyJobToken } from "@/lib/download-token";
import { buildGenerationPrompt, submitImageGeneration } from "@/lib/grsai/images";
import { createImageRenderConfig } from "@/lib/image-render-config";
import { normalizeWhiteBackground } from "@/lib/product-image-validation";
import { prepareGeneratedImageResult } from "@/lib/product-image-result";
import { fetchPublicImage } from "@/lib/remote-image";
import { POST } from "./route";

vi.mock("@/lib/grsai/images", () => ({
  buildGenerationPrompt: vi.fn(() => "final prompt"),
  submitImageGeneration: vi.fn(),
}));
vi.mock("@/lib/product-image-result", () => ({ prepareGeneratedImageResult: vi.fn() }));
vi.mock("@/lib/product-image-validation", () => ({ normalizeWhiteBackground: vi.fn() }));
vi.mock("@/lib/remote-image", () => ({ fetchPublicImage: vi.fn() }));

const webpSignature = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const requestHeaders = { "X-Product-Studio-Request": "1" };

function generationForm(options: {
  imageCount?: number;
  imageBytes?: BlobPart;
  imageType?: string;
  settings?: unknown;
  item?: unknown;
  baseImageToken?: string;
} = {}) {
  const form = new FormData();
  const imageCount = options.imageCount ?? 1;
  for (let index = 0; index < imageCount; index += 1) {
    form.append("images", new File(
      [options.imageBytes ?? webpSignature],
      `${index}.webp`,
      { type: options.imageType ?? "image/webp" },
    ));
  }
  form.append("settings", JSON.stringify(options.settings ?? defaultSettings));
  form.append("item", JSON.stringify(options.item ?? makePlanItems(1)[0]));
  if (options.baseImageToken) form.append("baseImageToken", options.baseImageToken);
  return form;
}

function imageOneToken(nowSeconds?: number, ttlSeconds?: number) {
  return signDownloadUrl(
    "https://cdn.example/main.png",
    createImageRenderConfig(analysisWithTwoItems.plan[0], defaultSettings),
    "download-secret",
    nowSeconds,
    ttlSeconds,
  );
}

function generationRequest(form: FormData, headers: HeadersInit = requestHeaders) {
  return new Request("http://localhost/api/product/generate", { method: "POST", body: form, headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "download-secret";
  vi.mocked(prepareGeneratedImageResult).mockImplementation(async ({ render }) => ({ ok: true, render }));
  vi.mocked(fetchPublicImage).mockResolvedValue(Buffer.from("source image"));
  vi.mocked(normalizeWhiteBackground).mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
});

afterEach(() => {
  delete process.env.GRSAI_API_KEY;
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});

it("rejects a request without the private browser header before parsing multipart data", async () => {
  const request = generationRequest(generationForm(), {});
  const formDataSpy = vi.spyOn(request, "formData");

  const response = await POST(request);

  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "请求来源无效" });
  expect(formDataSpy).not.toHaveBeenCalled();
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("rejects zero and more than six normalized images", async () => {
  expect((await POST(generationRequest(generationForm({ imageCount: 0 })))).status).toBe(400);
  expect((await POST(generationRequest(generationForm({ imageCount: 7 })))).status).toBe(400);
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it.each([
  ["an unsupported MIME type", { imageType: "image/gif", imageBytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]) }],
  ["a file larger than 5 MB", { imageBytes: new Uint8Array(5 * 1024 * 1024 + 1) }],
  ["spoofed WEBP bytes", { imageBytes: new TextEncoder().encode("not a webp") }],
] as const)("rejects %s at the upload boundary", async (_label, options) => {
  if (options.imageBytes.byteLength > 5 * 1024 * 1024) {
    options.imageBytes.set(webpSignature, 0);
  }

  const response = await POST(generationRequest(generationForm(options)));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "图片格式或大小不符合要求" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("rejects invalid settings and plan items at the untrusted route boundary", async () => {
  const invalidSettings = await POST(generationRequest(generationForm({
    settings: { ...defaultSettings, imageCount: 0 },
  })));
  const invalidItem = await POST(generationRequest(generationForm({
    item: { ...makePlanItems(1)[0], prompt: "" },
  })));

  expect(invalidSettings.status).toBe(400);
  expect(await invalidSettings.json()).toEqual({ error: "生成参数或规划项无效" });
  expect(invalidItem.status).toBe(400);
  expect(await invalidItem.json()).toEqual({ error: "生成参数或规划项无效" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it.each(["01", "not-an-index", "3"])("rejects malformed or out-of-range plan id %s as 400", async (id) => {
  const response = await POST(generationRequest(generationForm({
    settings: { ...defaultSettings, imageCount: 2 },
    item: { ...makePlanItems(1)[0], id },
  })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "生成参数或规划项无效" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("requires image two to reference a signed image-one result", async () => {
  const response = await POST(generationRequest(generationForm({
    settings: defaultSettings,
    item: analysisWithTwoItems.plan[1],
  })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "生成参数或规划项无效" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it.each([
  ["tampered", "not-a-signed-token"],
  ["expired", imageOneToken(1, 1)],
  ["wrong image", signDownloadUrl(
    "https://cdn.example/dimension.png",
    createImageRenderConfig(analysisWithTwoItems.plan[1], defaultSettings),
    "download-secret",
  )],
])("rejects a %s base image token before calling the provider", async (_label, baseImageToken) => {
  const response = await POST(generationRequest(generationForm({
    settings: defaultSettings,
    item: analysisWithTwoItems.plan[1],
    baseImageToken,
  })));

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "生成参数或规划项无效" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
  expect(fetchPublicImage).not.toHaveBeenCalled();
});

it("prepends the normalized signed image-one result to image-two references", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "job-2",
    status: "running",
    progress: 0,
    results: [],
  });

  const response = await POST(generationRequest(generationForm({
    settings: defaultSettings,
    item: analysisWithTwoItems.plan[1],
    baseImageToken: imageOneToken(),
  })));

  expect(response.status).toBe(200);
  expect(fetchPublicImage).toHaveBeenCalledWith("https://cdn.example/main.png");
  expect(normalizeWhiteBackground).toHaveBeenCalledWith(Buffer.from("source image"));
  expect(submitImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
    images: [
      "data:image/png;base64,iVBORw==",
      "data:image/webp;base64,UklGRgAAAABXRUJQ",
    ],
  }));
});

it("returns a signed job token that keeps the render config with a running submission", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "job-1",
    status: "running",
    progress: 0,
    results: [],
  });

  const response = await POST(generationRequest(generationForm()));

  expect(buildGenerationPrompt).toHaveBeenCalledWith(makePlanItems(1)[0], defaultSettings);
  expect(submitImageGeneration).toHaveBeenCalledWith({
    images: ["data:image/webp;base64,UklGRgAAAABXRUJQ"],
    prompt: "final prompt",
    aspectRatio: "1024x1536",
    quality: "auto",
  });
  const body = await response.json();

  expect(body).toMatchObject({
    task: {
      planItemId: "1",
      status: "running",
      progress: 0,
    },
  });
  expect(body.task.providerJobId).not.toBe("job-1");
  expect(verifyJobToken(body.task.providerJobId, "download-secret")).toEqual({
    providerJobId: "job-1",
    render: {
      imageIndex: 1,
      annotations: [],
      watermark: "",
      applyWatermark: false,
    },
  });
});

it("returns an inline same-origin result with the identical signed render config", async () => {
  const item = {
    ...analysisWithTwoItems.plan[1],
    annotations: [{ id: "height", label: "杯高", displayValue: "12 cm" }],
  };
  const settings = { ...defaultSettings, watermark: "Brand" };
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/result.png" }],
  });
  vi.mocked(prepareGeneratedImageResult).mockImplementationOnce(async ({ render }) => ({
    ok: true,
    render: {
      ...render,
      dimensionLayout: {
        bounds: { left: 260, top: 220, right: 740, bottom: 820 },
        placements: [{ id: "height", axis: "vertical", side: "right" }],
      },
    },
  }));

  const response = await POST(generationRequest(generationForm({
    item,
    settings,
    baseImageToken: imageOneToken(),
  })));
  const body = await response.json();

  expect(body).toMatchObject({
    task: {
      planItemId: "2",
      status: "succeeded",
      progress: 100,
    },
  });
  expect(body.task).not.toHaveProperty("providerJobId");
  const resultUrl = new URL(body.task.resultUrl);
  expect(resultUrl.origin).toBe("http://localhost");
  expect(resultUrl.pathname).toBe("/api/product/download");
  expect(resultUrl.searchParams.get("inline")).toBe("1");
  expect(resultUrl.searchParams.get("token")).toBe(body.task.downloadToken);
  expect(verifyDownloadToken(body.task.downloadToken, "download-secret"))
    .toEqual({
      url: "https://cdn.example/result.png",
      render: {
        imageIndex: 2,
        annotations: [{ id: "height", label: "杯高", displayValue: "12 cm" }],
        dimensionLayout: {
          bounds: { left: 260, top: 220, right: 740, bottom: 820 },
          placements: [{ id: "height", axis: "vertical", side: "right" }],
        },
        watermark: "Brand",
        applyWatermark: true,
      },
    });
});

it("keeps an incomplete immediate success resumable without exposing the paid provider job id", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [],
  });

  const response = await POST(generationRequest(generationForm()));

  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    task: {
      planItemId: "1",
      status: "running",
      progress: 100,
    },
  });
  expect(body.task.providerJobId).not.toBe("job-1");
  expect(verifyJobToken(body.task.providerJobId, "download-secret")).toMatchObject({
    providerJobId: "job-1",
  });
});

it("returns a non-white image-one result as a retryable failed task without signing it", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/non-white.png" }],
  });
  vi.mocked(prepareGeneratedImageResult).mockResolvedValue({
    ok: false,
    error: "白底商品主图背景处理失败，请重试此图",
  });

  const response = await POST(generationRequest(generationForm({
    settings: { ...defaultSettings, imageCount: 1 },
    item: makePlanItems(1)[0],
  })));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.task).toEqual({
    planItemId: "1",
    status: "failed",
    progress: 100,
    error: "白底商品主图背景处理失败，请重试此图",
  });
  expect(body.task).not.toHaveProperty("downloadToken");
  expect(prepareGeneratedImageResult).toHaveBeenCalledWith(expect.objectContaining({
    url: "https://cdn.example/non-white.png",
    render: expect.objectContaining({ imageIndex: 1 }),
  }));
});

it("returns 503 without calling the provider when the API key is absent", async () => {
  delete process.env.GRSAI_API_KEY;

  const response = await POST(generationRequest(generationForm()));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "图片生成服务尚未配置" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("returns 503 without calling the provider when download signing is unavailable", async () => {
  delete process.env.DOWNLOAD_TOKEN_SECRET;

  const response = await POST(generationRequest(generationForm()));

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "图片生成服务尚未配置" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("rejects an oversized declared body before parsing multipart data", async () => {
  const request = generationRequest(generationForm(), {
    ...requestHeaders,
    "Content-Length": String(36 * 1024 * 1024 + 1),
  });
  const formDataSpy = vi.spyOn(request, "formData");

  const response = await POST(request);

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "请求体不能超过 36 MB" });
  expect(formDataSpy).not.toHaveBeenCalled();
  expect(submitImageGeneration).not.toHaveBeenCalled();
});
