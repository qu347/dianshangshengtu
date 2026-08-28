import { expect, it, vi } from "vitest";
import { preprocessClothingImage, validateGarmentFiles } from "./image-files";

const image = (name: string, type = "image/png", size = 10) => (
  new File([new Uint8Array(size)], name, { type })
);

it("accepts one through six supported garment images", () => {
  expect(validateGarmentFiles([image("a.png")])).toEqual([]);
  expect(validateGarmentFiles(Array.from({ length: 6 }, (_, index) => image(`${index}.webp`, "image/webp"))))
    .toEqual([]);
});

it("returns garment-specific count, type, and source-size errors", () => {
  expect(validateGarmentFiles([])).toContain("请至少上传 1 张服装图");
  expect(validateGarmentFiles(Array.from({ length: 7 }, (_, index) => image(`${index}.png`))))
    .toContain("最多上传 6 张服装图");
  expect(validateGarmentFiles([image("a.gif", "image/gif")])).toContain("仅支持 JPG、PNG、WEBP 图片");
  expect(validateGarmentFiles([image("large.png", "image/png", 15 * 1024 * 1024 + 1)]))
    .toContain("单张服装原图不能超过 15 MB");
});

it("corrects orientation, limits the longest edge to 2048, and returns WEBP", async () => {
  const close = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 3000, height: 1500, close }));
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
    .mockImplementation((callback) => callback(new Blob(["webp"], { type: "image/webp" })));

  const result = await preprocessClothingImage(image("large.png"));
  expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2048, 1024);
  expect(result).toMatchObject({ name: "large.webp", type: "image/webp" });
  expect(close).toHaveBeenCalled();
});

