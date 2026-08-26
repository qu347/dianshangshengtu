import type { DimensionItem, GenerationSettings } from "../model";

export type PreparedDimensionFact = {
  id: string;
  sourceLabel: string;
  displayValue: string;
};

type DimensionLanguage = "zh-CN" | "en" | "ru";

export function dimensionLanguage(language: GenerationSettings["language"]): DimensionLanguage {
  return language === "none" ? "zh-CN" : language;
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error("尺寸换算结果必须是有限数值");
  return Number(value.toFixed(2)).toString();
}

function lengthInCentimeters(item: DimensionItem) {
  switch (item.unit) {
    case "mm":
      return item.value / 10;
    case "cm":
      return item.value;
    case "m":
      return item.value * 100;
    case "in":
      return item.value * 2.54;
    default:
      throw new Error(`不支持的长度单位：${item.unit}`);
  }
}

function volumeInMilliliters(item: DimensionItem) {
  switch (item.unit) {
    case "ml":
      return item.value;
    case "l":
      return item.value * 1000;
    default:
      throw new Error(`不支持的容量单位：${item.unit}`);
  }
}

function formatDimensionValue(item: DimensionItem, language: DimensionLanguage) {
  if (item.unit === "custom") {
    if (!item.customUnit) throw new Error("自定义单位缺失");
    return `${compactNumber(item.value)} ${item.customUnit}`;
  }

  if (item.unit === "ml" || item.unit === "l") {
    const milliliters = volumeInMilliliters(item);
    if (language === "en") return `${compactNumber(milliliters / 29.5735)} fl oz`;
    if (milliliters >= 1000) return `${compactNumber(milliliters / 1000)} ${language === "ru" ? "л" : "L"}`;
    return `${compactNumber(milliliters)} ${language === "ru" ? "мл" : "mL"}`;
  }

  const centimeters = lengthInCentimeters(item);
  if (language === "en") return `${compactNumber(centimeters / 2.54)} in`;
  return `${compactNumber(centimeters)} ${language === "ru" ? "см" : "cm"}`;
}

export function prepareDimensionFacts(items: DimensionItem[], language: GenerationSettings["language"]): PreparedDimensionFact[] {
  const targetLanguage = dimensionLanguage(language);
  return items.map((item) => ({
    id: item.id,
    sourceLabel: item.label,
    displayValue: formatDimensionValue(item, targetLanguage),
  }));
}
