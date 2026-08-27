import { expect, it } from "vitest";
import type { DimensionAnnotation } from "@/features/product-studio/model";
import { bindDimensionLayout, fallbackDimensionLayout } from "./dimension-layout";

const annotations: DimensionAnnotation[] = [
  { id: "width", label: "宽", displayValue: "9 cm" },
  { id: "height", label: "高", displayValue: "5 cm" },
];

it("binds exact stable ids to a validated smart layout", () => {
  expect(bindDimensionLayout({
    bounds: { left: 180, top: 220, right: 820, bottom: 820 },
    placements: [
      { id: "width", axis: "horizontal", side: "top" },
      { id: "height", axis: "vertical", side: "right" },
    ],
  }, annotations)).toEqual({
    bounds: { left: 180, top: 220, right: 820, bottom: 820 },
    placements: [
      { id: "width", axis: "horizontal", side: "top" },
      { id: "height", axis: "vertical", side: "right" },
    ],
  });
});

it.each([
  ["reordered", [
    { id: "height", axis: "vertical", side: "right" },
    { id: "width", axis: "horizontal", side: "top" },
  ]],
  ["duplicate", [
    { id: "width", axis: "horizontal", side: "top" },
    { id: "width", axis: "vertical", side: "right" },
  ]],
  ["missing", [{ id: "width", axis: "horizontal", side: "top" }]],
] as const)("rejects a %s dimension id layout", (_label, placements) => {
  expect(() => bindDimensionLayout({
    bounds: { left: 180, top: 220, right: 820, bottom: 820 },
    placements,
  }, annotations)).toThrow("尺寸布局 ID");
});

it.each([
  { left: -1, top: 220, right: 820, bottom: 820 },
  { left: 800, top: 220, right: 820, bottom: 820 },
  { left: 180, top: 800, right: 820, bottom: 820 },
])("rejects unsafe normalized product bounds", (bounds) => {
  expect(() => bindDimensionLayout({
    bounds,
    placements: [
      { id: "width", axis: "horizontal", side: "top" },
      { id: "height", axis: "vertical", side: "right" },
    ],
  }, annotations)).toThrow("商品边界");
});

it("creates deterministic placements for up to six arbitrary dimensions", () => {
  const six = Array.from({ length: 6 }, (_, index) => ({
    id: `dimension-${index + 1}`,
    label: `尺寸 ${index + 1}`,
    displayValue: `${index + 1} cm`,
  }));

  expect(fallbackDimensionLayout(six)).toEqual({
    bounds: { left: 220, top: 250, right: 780, bottom: 780 },
    placements: [
      { id: "dimension-1", axis: "horizontal", side: "top" },
      { id: "dimension-2", axis: "vertical", side: "right" },
      { id: "dimension-3", axis: "horizontal", side: "bottom" },
      { id: "dimension-4", axis: "vertical", side: "left" },
      { id: "dimension-5", axis: "callout", side: "right" },
      { id: "dimension-6", axis: "callout", side: "left" },
    ],
  });
});
