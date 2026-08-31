// @vitest-environment node

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "@/features/clothing-studio/test-fixtures";
import { resolveClothingReference } from "@/lib/clothing-reference";
import { ClothingPayloadTooLargeError, readBoundedClothingFormData } from "@/lib/clothing-upload";
import { analyzeClothing } from "@/lib/grsai/clothing-analysis";
import { POST } from "./route";

vi.mock("@/lib/clothing-reference", () => ({ resolveClothingReference: vi.fn() }));
vi.mock("@/lib/clothing-upload", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/clothing-upload")>();
  return {
    ...actual,
    readBoundedClothingFormData: vi.fn((request: Request) => request.formData()),
  };
});
vi.mock("@/lib/grsai/clothing-analysis", () => ({ analyzeClothing: vi.fn() }));

const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const headers = { "X-Clothing-Studio-Request": "1" };

function form(options: { garmentCount?: number; settings?: unknown } = {}) {
  const data = new FormData();
  for (let index = 0; index < (options.garmentCount ?? 1); index += 1) {
    data.append("garments", new File([webp], `${index}.webp`, { type: "image/webp" }));
  }
  data.append("settings", JSON.stringify(options.settings ?? defaultClothingSettings));
  data.append("requirements", "突出垂坠感");
  data.append("modelToken", "signed-model");
  return data;
}

function request(data: FormData, requestHeaders: HeadersInit = headers) {
  return new Request("http://localhost/api/clothing/analyze", {
    method: "POST",
    headers: requestHeaders,
    body: data,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRSAI_API_KEY = "test-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "test-secret";
  vi.mocked(resolveClothingReference)
    .mockResolvedValueOnce("data:image/webp;base64,bW9kZWw=")
    .mockResolvedValueOnce(undefined);
  vi.mocked(analyzeClothing).mockResolvedValue(makeClothingAnalysis(2));
});
afterEach(() => {
  delete process.env.GRSAI_API_KEY;
  delete process.env.DOWNLOAD_TOKEN_SECRET;
});
it("converts garments and resolves exactly one model plus an optional scene", async () => {
  const response = await POST(request(form()));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ analysis: makeClothingAnalysis(2) });
  expect(analyzeClothing).toHaveBeenCalledWith({
    garments: ["data:image/webp;base64,UklGRgAAAABXRUJQ"],
    model: "data:image/webp;base64,bW9kZWw=",
    scene: undefined,
    settings: defaultClothingSettings,
    requirements: "突出垂坠感",
  });
  expect(resolveClothingReference).toHaveBeenCalledTimes(2);
});
it("rejects missing or excessive garments before calling the provider", async () => {
  expect((await POST(request(form({ garmentCount: 0 })))).status).toBe(400);
  expect((await POST(request(form({ garmentCount: 7 })))).status).toBe(400);
  expect(analyzeClothing).not.toHaveBeenCalled();
});
it("returns 413 when the streamed multipart body exceeds 48 MB", async () => {
  vi.mocked(readBoundedClothingFormData).mockRejectedValueOnce(new ClothingPayloadTooLargeError());

  const response = await POST(request(form()));

  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "请求体不能超过 48 MB" });
  expect(analyzeClothing).not.toHaveBeenCalled();
});
it("rejects invalid settings and an invalid model source", async () => {
  const invalidSettings = await POST(request(form({
    settings: { ...defaultClothingSettings, imageCount: 17 },
  })));
  expect(invalidSettings.status).toBe(400);

  vi.mocked(resolveClothingReference).mockReset();
  vi.mocked(resolveClothingReference).mockRejectedValue(new Error("模特图来源无效"));
  const invalidModel = await POST(request(form()));
  expect(invalidModel.status).toBe(400);
  expect(await invalidModel.json()).toEqual({ error: "模特图或场景图来源无效" });
  expect(analyzeClothing).not.toHaveBeenCalled();
});
