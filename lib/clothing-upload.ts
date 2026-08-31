const maxImageBytes = 5 * 1024 * 1024;
const maxRequestBytes = 48 * 1024 * 1024;

export const clothingRequestHeaders = { "X-Clothing-Studio-Request": "1" } as const;

export function validateClothingPostRequest(request: Request) {
  if (request.headers.get("X-Clothing-Studio-Request") !== "1") {
    return Response.json({ error: "请求来源无效" }, { status: 403 });
  }
  const declaredLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
    return Response.json({ error: "请求体不能超过 48 MB" }, { status: 413 });
  }
  return null;
}

export class ClothingPayloadTooLargeError extends Error {
  constructor() {
    super("请求体不能超过 48 MB");
    this.name = "ClothingPayloadTooLargeError";
  }
}

export async function readBoundedClothingFormData(request: Request): Promise<FormData> {
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
        try {
          await reader.cancel("请求体超过上限");
        } catch {
          // Cancellation is best-effort; the stable 413 error remains authoritative.
        }
        throw new ClothingPayloadTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Blob(chunks as unknown as BlobPart[], {
    type: request.headers.get("Content-Type") ?? "",
  });
  return new Request("http://localhost/clothing-upload", { method: "POST", body }).formData();
}

function startsWith(bytes: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

async function hasMatchingImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (file.type === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (file.type === "image/png") {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (file.type === "image/webp") {
    return startsWith(bytes, [0x52, 0x49, 0x46, 0x46])
      && startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]);
  }
  return false;
}

export async function validateClothingImages(
  form: FormData,
  field: string,
  options: { min: number; max: number; label: string },
) {
  const images = form.getAll(field).filter((value): value is File => value instanceof File);
  if (images.length < options.min) {
    return { error: `请至少上传 ${options.min} 张${options.label}` } as const;
  }
  if (images.length > options.max) {
    return { error: `最多上传 ${options.max} 张${options.label}` } as const;
  }
  if (images.some((file) => file.size > maxImageBytes)) {
    return { error: `${options.label}格式或大小不符合要求` } as const;
  }
  const validSignatures = await Promise.all(images.map(hasMatchingImageSignature));
  if (validSignatures.some((valid) => !valid)) {
    return { error: `${options.label}格式或大小不符合要求` } as const;
  }
  return { images } as const;
}
