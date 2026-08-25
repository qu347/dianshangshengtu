import { expect, it, vi } from "vitest";
import { preprocessProductImage, validateProductFiles } from "./image-files";

const image = (name: string, type = "image/png", size = 10) => new File([new Uint8Array(size)], name, { type });

it("accepts one through six supported images", () => {
  expect(validateProductFiles([image("a.png")])).toEqual([]);
  expect(validateProductFiles(Array.from({ length: 6 }, (_, index) => image(`${index}.png`)))).toEqual([]);
});

it("reports count, type, and 15 MB original size errors", () => {
  expect(validateProductFiles([])).toContain("请至少上传 1 张产品图");
  expect(validateProductFiles(Array.from({ length: 7 }, (_, i) => image(`${i}.png`)))).toContain("最多上传 6 张产品图");
  expect(validateProductFiles([image("a.gif", "image/gif")])).toContain("仅支持 JPG、PNG、WEBP 图片");
  expect(validateProductFiles([image("large.png", "image/png", 15 * 1024 * 1024 + 1)])).toContain("单张原图不能超过 15 MB");
});

it("scales a 3000 by 1500 image to 2048 by 1024 and returns WEBP", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 3000, height: 1500, close }));
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["webp"], { type: "image/webp" })));

  const result = await preprocessProductImage(image("large.png"));

  expect(document.querySelector("canvas")).toBeNull();
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1024);
  expect(result.type).toBe("image/webp");
  expect(close).toHaveBeenCalled();
});
