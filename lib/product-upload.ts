const maxImageBytes = 5 * 1024 * 1024;
const maxRequestBytes = 36 * 1024 * 1024;

export const productRequestHeaders = { "X-Product-Studio-Request": "1" } as const;

export function validateProductPostRequest(request: Request) {
  if (request.headers.get("X-Product-Studio-Request") !== "1") {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  if (Number(request.headers.get("Content-Length")) > maxRequestBytes) {
    return Response.json({ error: "请求体不能超过 36 MB" }, { status: 413 });
  }
  return null;
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super("请求体不能超过 36 MB");
    this.name = "PayloadTooLargeError";
  }
}

// The declared Content-Length header is client-controlled and absent for
// chunked bodies, so the byte cap is enforced while the stream is consumed.
export async function readBoundedFormData(request: Request): Promise<FormData> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("请求体为空");

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxRequestBytes) {
        await reader.cancel("请求体超过上限");
        throw new PayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Blob(chunks as unknown as BlobPart[], { type: request.headers.get("Content-Type") ?? "" });
  return await new Request("http://localhost/product-upload", { method: "POST", body }).formData();
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

export async function hasMatchingImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (file.type === "image/png") return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (file.type === "image/webp") {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
  }
  return false;
}

export async function validateProductImages(form: FormData) {
  const images = form.getAll("images").filter((value): value is File => value instanceof File);
  if (images.length === 0) return { error: "请至少上传 1 张产品图" } as const;
  if (images.length > 6) return { error: "最多上传 6 张产品图" } as const;
  if (images.some((file) => file.size > maxImageBytes)) {
    return { error: "图片格式或大小不符合要求" } as const;
  }
  const signatures = await Promise.all(images.map(hasMatchingImageSignature));
  if (signatures.some((valid) => !valid)) {
    return { error: "图片格式或大小不符合要求" } as const;
  }
  return { images } as const;
}
