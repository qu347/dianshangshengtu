// @vitest-environment node

import { expect, it } from "vitest";
import {
  hasMatchingImageSignature,
  PayloadTooLargeError,
  readBoundedFormData,
} from "./product-upload";

it("reads a bounded multipart form and preserves its uploaded file", async () => {
  const form = new FormData();
  form.append("image", new File(["image bytes"], "product.png", { type: "image/png" }));
  const request = new Request("http://localhost/upload", { method: "POST", body: form });

  const parsed = await readBoundedFormData(request);

  expect(parsed.get("image")).toMatchObject({ name: "product.png", type: "image/png" });
});

it("rejects a streaming request that exceeds the byte limit", async () => {
  const oversized = new Uint8Array(36 * 1024 * 1024 + 1);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(oversized);
      controller.close();
    },
  });
  const request = new Request("http://localhost/upload", {
    method: "POST",
    body,
    duplex: "half",
  } as RequestInit);

  await expect(readBoundedFormData(request)).rejects.toBeInstanceOf(PayloadTooLargeError);
});

it("checks uploaded image signatures before a provider call", async () => {
  const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "photo.jpg", { type: "image/jpeg" });
  const disguised = new File(["not an image"], "photo.jpg", { type: "image/jpeg" });

  await expect(hasMatchingImageSignature(jpeg)).resolves.toBe(true);
  await expect(hasMatchingImageSignature(disguised)).resolves.toBe(false);
});
