// @vitest-environment node

import { expect, it } from "vitest";
import {
  ClothingPayloadTooLargeError,
  clothingRequestHeaders,
  readBoundedClothingFormData,
  validateClothingImages,
  validateClothingPostRequest,
} from "./clothing-upload";

const webpSignature = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

function garmentForm(count: number, bytes: BlobPart = webpSignature, type = "image/webp") {
  const form = new FormData();
  for (let index = 0; index < count; index += 1) {
    form.append("garments", new File([bytes], `${index}.webp`, { type }));
  }
  return form;
}

function oversizedStreamingRequest(contentLength?: string, cancelFails = false) {
  const chunk = new Uint8Array(1024 * 1024);
  let sentChunks = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sentChunks < 49) {
        controller.enqueue(chunk);
        sentChunks += 1;
        return;
      }
      controller.close();
    },
    cancel() {
      if (cancelFails) return Promise.reject(new Error("cancel failed"));
    },
  });
  return new Request("http://localhost/api/clothing/analyze", {
    method: "POST",
    headers: {
      ...clothingRequestHeaders,
      "Content-Type": "multipart/form-data; boundary=bounded-test",
      ...(contentLength ? { "Content-Length": contentLength } : {}),
    },
    body,
    duplex: "half",
  } as RequestInit);
}

it("requires the private clothing header before reading multipart data", () => {
  const invalid = new Request("http://localhost/api/clothing/analyze", { method: "POST" });
  const valid = new Request("http://localhost/api/clothing/analyze", {
    method: "POST",
    headers: clothingRequestHeaders,
  });

  expect(validateClothingPostRequest(invalid)?.status).toBe(403);
  expect(validateClothingPostRequest(valid)).toBeNull();
});

it("rejects a declared body larger than 48 MB", () => {
  const request = new Request("http://localhost/api/clothing/analyze", {
    method: "POST",
    headers: {
      ...clothingRequestHeaders,
      "Content-Length": String(48 * 1024 * 1024 + 1),
    },
  });

  expect(validateClothingPostRequest(request)?.status).toBe(413);
});

it("rejects an oversized streaming body without Content-Length", async () => {
  await expect(readBoundedClothingFormData(oversizedStreamingRequest()))
    .rejects.toBeInstanceOf(ClothingPayloadTooLargeError);
});

it("rejects an oversized streaming body with a forged small Content-Length", async () => {
  await expect(readBoundedClothingFormData(oversizedStreamingRequest("1")))
    .rejects.toMatchObject({ message: "请求体不能超过 48 MB" });
});

it("keeps the 413 error when cancelling the oversized stream fails", async () => {
  await expect(readBoundedClothingFormData(oversizedStreamingRequest(undefined, true)))
    .rejects.toBeInstanceOf(ClothingPayloadTooLargeError);
});

it("requires 1-6 valid garment files", async () => {
  expect(await validateClothingImages(garmentForm(0), "garments", {
    min: 1, max: 6, label: "服装图",
  })).toEqual({ error: "请至少上传 1 张服装图" });
  expect(await validateClothingImages(garmentForm(7), "garments", {
    min: 1, max: 6, label: "服装图",
  })).toEqual({ error: "最多上传 6 张服装图" });
  expect(await validateClothingImages(garmentForm(1), "garments", {
    min: 1, max: 6, label: "服装图",
  })).toMatchObject({ images: [expect.any(File)] });
});

it("rejects spoofed image MIME types, magic bytes, and oversized normalized files", async () => {
  expect(await validateClothingImages(garmentForm(1, "not-webp"), "garments", {
    min: 1, max: 6, label: "服装图",
  })).toEqual({ error: "服装图格式或大小不符合要求" });
  expect(await validateClothingImages(garmentForm(1, new Uint8Array([0x47, 0x49]), "image/gif"), "garments", {
    min: 1, max: 6, label: "服装图",
  })).toEqual({ error: "服装图格式或大小不符合要求" });

  const oversized = new Uint8Array(5 * 1024 * 1024 + 1);
  oversized.set(webpSignature);
  expect(await validateClothingImages(garmentForm(1, oversized), "garments", {
    min: 1, max: 6, label: "服装图",
  })).toEqual({ error: "服装图格式或大小不符合要求" });
});
