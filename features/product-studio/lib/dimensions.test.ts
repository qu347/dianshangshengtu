import { expect, it } from "vitest";
import { bindDimensionAnnotations, dimensionLanguage, prepareDimensionFacts } from "./dimensions";

const height = { id: "height", label: "杯高", value: 12, unit: "cm" as const };
const capacity = { id: "capacity", label: "容量", value: 350, unit: "ml" as const };

it("formats Chinese, English, and Russian standard units", () => {
  expect(prepareDimensionFacts([height], "zh-CN")[0].displayValue).toBe("12 cm");
  expect(prepareDimensionFacts([height], "en")[0].displayValue).toBe("4.72 in");
  expect(prepareDimensionFacts([height], "ru")[0].displayValue).toBe("12 см");
  expect(prepareDimensionFacts([capacity], "en")[0].displayValue).toBe("11.83 fl oz");
  expect(prepareDimensionFacts([{ ...capacity, value: 1500 }], "ru")[0].displayValue).toBe("1.5 л");
});

it("uses Chinese dimension units for no-marketing-copy mode", () => {
  expect(prepareDimensionFacts([height], "none")[0].displayValue).toBe("12 cm");
});

it("preserves a custom unit", () => {
  const result = prepareDimensionFacts([{ id: "size", label: "规格", value: 2, unit: "custom", customUnit: "号" }], "en");
  expect(result[0].displayValue).toBe("2 号");
});

it("maps no-marketing-copy language to Chinese", () => {
  expect(dimensionLanguage("none")).toBe("zh-CN");
  expect(dimensionLanguage("ru")).toBe("ru");
});

it("converts canonical length units and applies the volume threshold", () => {
  expect(prepareDimensionFacts([{ id: "mm", label: "毫米", value: 10, unit: "mm" }], "zh-CN")[0].displayValue).toBe("1 cm");
  expect(prepareDimensionFacts([{ id: "m", label: "米", value: 1, unit: "m" }], "en")[0].displayValue).toBe("39.37 in");
  expect(prepareDimensionFacts([{ id: "in", label: "英寸", value: 1, unit: "in" }], "ru")[0].displayValue).toBe("2.54 см");
  expect(prepareDimensionFacts([{ id: "small", label: "小容量", value: 999, unit: "ml" }], "zh-CN")[0].displayValue).toBe("999 mL");
  expect(prepareDimensionFacts([{ id: "large", label: "大容量", value: 1000, unit: "ml" }], "zh-CN")[0].displayValue).toBe("1 L");
  expect(prepareDimensionFacts([{ id: "liters", label: "升", value: 1.5, unit: "l" }], "ru")[0].displayValue).toBe("1.5 л");
});

it("preserves result order and source metadata", () => {
  expect(prepareDimensionFacts([capacity, height], "zh-CN")).toEqual([
    { id: "capacity", sourceLabel: "容量", displayValue: "350 mL" },
    { id: "height", sourceLabel: "杯高", displayValue: "12 cm" },
  ]);
});

it("rejects non-finite conversion output", () => {
  expect(() => prepareDimensionFacts([{ id: "overflow", label: "溢出", value: Number.MAX_VALUE, unit: "m" }], "zh-CN")).toThrow();
});

it("preserves the trusted dimension id when binding translated labels", () => {
  expect(bindDimensionAnnotations(
    [{ id: "height", label: "Высота" }],
    [{ id: "height", sourceLabel: "高", displayValue: "5 см" }],
  )).toEqual([{ id: "height", label: "Высота", displayValue: "5 см" }]);
});
