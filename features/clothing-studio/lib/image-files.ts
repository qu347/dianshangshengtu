const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ORIGINAL_MAX_BYTES = 15 * 1024 * 1024;
const NORMALIZED_MAX_BYTES = 5 * 1024 * 1024;

export function validateGarmentFiles(files: File[]) {
  const errors: string[] = [];
  if (files.length === 0) errors.push("请至少上传 1 张服装图");
  if (files.length > 6) errors.push("最多上传 6 张服装图");
  if (files.some((file) => !ACCEPTED_TYPES.has(file.type))) {
    errors.push("仅支持 JPG、PNG、WEBP 图片");
  }
  if (files.some((file) => file.size > ORIGINAL_MAX_BYTES)) {
    errors.push("单张服装原图不能超过 15 MB");
  }
  return errors;
}
export async function preprocessClothingImage(file: File) {
  let bitmap: ImageBitmap | undefined;
  let source: CanvasImageSource;
  let width: number;
  let height: number;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  try {
    const scale = Math.min(1, 2048 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法处理图片");
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("图片压缩失败")),
        "image/webp",
        0.9,
      );
    });
    if (blob.size > NORMALIZED_MAX_BYTES) {
      throw new Error("压缩后的服装图仍超过 5 MB，请使用尺寸更小的原图");
    }
    return new File([blob], file.name.replace(/\.[^.]+$/, ".webp"), { type: "image/webp" });
  } finally {
    bitmap?.close();
  }
}
