import { expect, it } from "vitest";
import { defaultSettings, makePlanItems } from "@/features/product-studio/test-fixtures";
import { createImageRenderConfig, inlineResultUrl } from "./image-render-config";

const onePlanItem = makePlanItems(1)[0];

it("creates the Amazon first-image watermark exception", () => {
  expect(createImageRenderConfig(
    { ...onePlanItem, id: "1" },
    { ...defaultSettings, platform: "amazon", language: "en", watermark: "Brand" },
  )).toMatchObject({
    imageIndex: 1,
    watermark: "Brand",
    applyWatermark: false,
  });
});

it("copies validated annotations and trims the watermark", () => {
  const item = {
    ...makePlanItems(2)[1],
    annotations: [
      { id: "height", label: " 杯高 ", displayValue: " 12 cm " },
      { id: "invalid", label: "", displayValue: "not rendered" },
    ],
  };

  expect(createImageRenderConfig(item as never, { ...defaultSettings, watermark: " Brand " })).toEqual({
    imageIndex: 2,
    annotations: [{ id: "height", label: "杯高", displayValue: "12 cm" }],
    dimensionLayout: {
      bounds: { left: 220, top: 250, right: 780, bottom: 780 },
      placements: [{ id: "height", axis: "horizontal", side: "top" }],
    },
    watermark: "Brand",
    applyWatermark: true,
  });
});

it.each(["0", "01", "1.5", "two", " 2 "])("rejects a non-normalized image id: %s", (id) => {
  expect(() => createImageRenderConfig({ ...onePlanItem, id }, defaultSettings)).toThrow("图片序号无效");
});

it("creates an absolute same-origin inline download URL", () => {
  const result = inlineResultUrl("https://shop.example/products/1?color=red#preview", "token & value");
  const url = new URL(result);

  expect(url.origin).toBe("https://shop.example");
  expect(url.pathname).toBe("/api/product/download");
  expect(url.searchParams.get("token")).toBe("token & value");
  expect(url.searchParams.get("inline")).toBe("1");
});
