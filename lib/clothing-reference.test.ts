// @vitest-environment node

import sharp from "sharp";
import { expect, it, vi } from "vitest";
import { signDownloadUrl } from "./download-token";
import { resolveClothingReference } from "./clothing-reference";
import type { ImageRenderConfig } from "./image-render-config";

const webpSignature = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const candidateRender: ImageRenderConfig = {
  imageIndex: 99,
  annotations: [],
  watermark: "",
  applyWatermark: false,
};

function modelOptions(required = true) {
  return {
    fileField: "modelImage",
    tokenField: "modelToken",
    label: "模特图",
    required,
  } as const;
}

it("returns an uploaded model as a validated data URL", async () => {
  const form = new FormData();
  form.append("modelImage", new File([webpSignature], "model.webp", { type: "image/webp" }));

  await expect(resolveClothingReference(form, modelOptions(), "secret"))
    .resolves.toBe("data:image/webp;base64,UklGRgAAAABXRUJQ");
});

it("returns undefined for a missing optional scene", async () => {
  await expect(resolveClothingReference(new FormData(), {
    fileField: "sceneImage",
    tokenField: "sceneToken",
    label: "场景图",
    required: false,
  }, "secret")).resolves.toBeUndefined();
});

it("rejects missing, ambiguous, tampered, and non-candidate reference sources", async () => {
  await expect(resolveClothingReference(new FormData(), modelOptions(), "secret"))
    .rejects.toThrow("模特图来源无效");

  const ambiguous = new FormData();
  ambiguous.append("modelImage", new File([webpSignature], "model.webp", { type: "image/webp" }));
  ambiguous.append("modelToken", signDownloadUrl("https://cdn.example/model.png", candidateRender, "secret"));
  await expect(resolveClothingReference(ambiguous, modelOptions(), "secret"))
    .rejects.toThrow("模特图来源无效");

  const tampered = new FormData();
  tampered.append("modelToken", "not-a-token");
  await expect(resolveClothingReference(tampered, modelOptions(), "secret"))
    .rejects.toThrow("模特图来源无效");

  const wrongRender = new FormData();
  wrongRender.append("modelToken", signDownloadUrl("https://cdn.example/product.png", {
    ...candidateRender,
    imageIndex: 1,
  }, "secret"));
  await expect(resolveClothingReference(wrongRender, modelOptions(), "secret"))
    .rejects.toThrow("模特图来源无效");
});

it("fetches a signed generated candidate and converts it to PNG", async () => {
  const source = await sharp({
    create: { width: 2, height: 3, channels: 3, background: "#b0b0b0" },
  }).webp().toBuffer();
  const fetchImage = vi.fn(async () => source);
  const form = new FormData();
  form.append("modelToken", signDownloadUrl(
    "https://cdn.example/model.webp",
    candidateRender,
    "secret",
  ));

  const resolved = await resolveClothingReference(form, modelOptions(), "secret", { fetchImage });

  expect(fetchImage).toHaveBeenCalledWith("https://cdn.example/model.webp");
  expect(resolved).toMatch(/^data:image\/png;base64,/);
  const png = Buffer.from(resolved!.split(",", 2)[1], "base64");
  await expect(sharp(png).metadata()).resolves.toMatchObject({ format: "png", width: 2, height: 3 });
});
