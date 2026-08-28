// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "@/features/clothing-studio/test-fixtures";
import { signDownloadUrl, verifyDownloadToken, verifyJobToken } from "@/lib/download-token";
import { buildClothingGenerationPrompt } from "@/lib/grsai/clothing-images";
import { submitImageGeneration } from "@/lib/grsai/images";
import { createClothingRenderConfig } from "@/lib/clothing-render-config";
import { prepareGeneratedImageResult } from "@/lib/product-image-result";
import { normalizeWhiteBackground } from "@/lib/product-image-validation";
import { fetchPublicImage } from "@/lib/remote-image";
import { POST } from "./route";

vi.mock("@/lib/grsai/images", () => ({ submitImageGeneration: vi.fn() }));
vi.mock("@/lib/product-image-result", () => ({ prepareGeneratedImageResult: vi.fn() }));
vi.mock("@/lib/product-image-validation", () => ({ normalizeWhiteBackground: vi.fn() }));
vi.mock("@/lib/remote-image", () => ({ fetchPublicImage: vi.fn() }));

const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
const headers = { "X-Clothing-Studio-Request": "1" };
const [firstItem, secondItem] = makeClothingAnalysis(2).plan;

type FormOptions = {
  item?: typeof firstItem;
  model?: boolean;
  scene?: boolean;
  baseImageToken?: string;
};

function form(options: FormOptions = {}) {
  const data = new FormData();
  data.append("garments", new File([webp], "garment.webp", { type: "image/webp" }));
  data.append("settings", JSON.stringify(defaultClothingSettings));
  data.append("item", JSON.stringify(options.item ?? firstItem));
  if (options.model) data.append("modelImage", new File([png], "model.png", { type: "image/png" }));
  if (options.scene) data.append("sceneImage", new File([jpeg], "scene.jpg", { type: "image/jpeg" }));
  if (options.baseImageToken) data.append("baseImageToken", options.baseImageToken);
  return data;
}

function request(data: FormData) {
  return new Request("http://localhost/api/clothing/generate", { method: "POST", body: data, headers });
}

function mainToken() {
  return signDownloadUrl(
    "https://cdn.example/main.png",
    createClothingRenderConfig(firstItem, defaultClothingSettings),
    "test-secret",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
  vi.mocked(fetchPublicImage).mockResolvedValue(Buffer.from("main-source"));
  vi.mocked(normalizeWhiteBackground).mockResolvedValue(Buffer.from("normalized-main"));
  vi.mocked(prepareGeneratedImageResult).mockImplementation(async ({ render }) => ({ ok: true, render }));
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    progress: 100,
    results: [{ url: "https://cdn.example/result.png" }],
  });
});

afterEach(() => {
  delete process.env.GRSAI_API_KEY;
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});

it("keeps image one garment-only and rejects all dependent references", async () => {
  const response = await POST(request(form({ model: true })));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "第 1 张只能使用服装参考图" });
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("accepts a legacy flat-lay image-one type as the canonical product image", async () => {
  const response = await POST(request(form({
    item: { ...firstItem, type: "flat_lay" } as unknown as typeof firstItem,
  })));

  expect(response.status).toBe(200);
  expect(submitImageGeneration).toHaveBeenCalledWith(expect.objectContaining({
    prompt: expect.stringContaining("白底立体服装主图"),
  }));
});

it("requires the successful image-one token and model for later images", async () => {
  const noBase = await POST(request(form({ item: secondItem, model: true })));
  expect(noBase.status).toBe(400);
  const noModel = await POST(request(form({ item: secondItem, baseImageToken: mainToken() })));
  expect(noModel.status).toBe(400);
  expect(submitImageGeneration).not.toHaveBeenCalled();
});

it("submits later images in normalized-main, garments, model, optional-scene order", async () => {
  const response = await POST(request(form({
    item: secondItem,
    model: true,
    scene: true,
    baseImageToken: mainToken(),
  })));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(fetchPublicImage).toHaveBeenCalledWith("https://cdn.example/main.png");
  expect(normalizeWhiteBackground).toHaveBeenCalledWith(
    Buffer.from("main-source"),
    { mode: "apparel" },
  );
  expect(submitImageGeneration).toHaveBeenCalledWith({
    images: [
      `data:image/png;base64,${Buffer.from("normalized-main").toString("base64")}`,
      "data:image/webp;base64,UklGRgAAAABXRUJQ",
      `data:image/png;base64,${Buffer.from(png).toString("base64")}`,
      `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`,
    ],
    prompt: buildClothingGenerationPrompt(secondItem, defaultClothingSettings, { hasScene: true }),
    aspectRatio: "1090x1443",
    quality: "auto",
  });
  expect(new URL(body.task.resultUrl).pathname).toBe("/api/clothing/download");
  expect(verifyDownloadToken(body.task.downloadToken, "test-secret").render.imageIndex).toBe(2);
});

it("returns a failed task without signing a rejected white-background result", async () => {
  vi.mocked(prepareGeneratedImageResult).mockResolvedValue({
    ok: false,
    error: "白底商品主图背景处理失败，请重试此图",
  });
  const response = await POST(request(form()));
  expect(await response.json()).toEqual({
    task: {
      planItemId: "1",
      status: "failed",
      progress: 100,
      error: "白底商品主图背景处理失败，请重试此图",
    },
  });
});

it("returns only an opaque provider job id while generation is running", async () => {
  vi.mocked(submitImageGeneration).mockResolvedValue({
    id: "raw-job",
    status: "running",
    progress: 20,
    results: [],
  });
  const body = await (await POST(request(form()))).json();
  expect(body.task.providerJobId).not.toContain("raw-job");
  expect(verifyJobToken(body.task.providerJobId, "test-secret").providerJobId).toBe("raw-job");
});
