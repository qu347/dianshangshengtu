"use client";

import type { ClothingGenerationSettings } from "../model";
import { fixedPlatformLanguage, settingsPatchForPlatform } from "@/features/product-studio/lib/platform-rules";

export const CLOTHING_PLATFORM_OPTIONS = [
  ["general", "通用电商"], ["taobao", "淘宝 / 天猫"], ["douyin", "抖音商城"],
  ["amazon", "Amazon"], ["shopify", "Shopify"], ["ozon", "Ozon"],
] as const;
const LANGUAGE_OPTIONS = [["none", "无营销文案"], ["zh-CN", "中文"], ["en", "英文"], ["ru", "俄文"]] as const;
export const CLOTHING_RATIO_OPTIONS = [
  ["1024x1024", "1:1 正方形"], ["1024x1536", "2:3 竖版"],
  ["1536x1024", "3:2 横版"], ["1090x1443", "3:4 竖版（1090×1443）"],
] as const;
const QUALITY_OPTIONS = [["auto", "自动"], ["low", "低"], ["medium", "中"], ["high", "高"]] as const;

type Props = {
  value: ClothingGenerationSettings;
  onChange: (patch: Partial<ClothingGenerationSettings>) => void;
  disabled?: boolean;
};

export function ClothingSettingsForm({ value, onChange, disabled = false }: Props) {
  const label = "block text-xs font-medium text-[#656a74]";
  const control = "mt-1.5 h-10 w-full rounded-xl border border-[#d9dce3] bg-white px-3 text-sm text-[#202329] disabled:bg-[#f2f3f5]";
  return (
    <div className="grid grid-cols-2 gap-3">
      <label className={label}>平台
        <select aria-label="平台" className={control} disabled={disabled} value={value.platform} onChange={(event) => onChange(settingsPatchForPlatform(event.currentTarget.value as ClothingGenerationSettings["platform"], value.language))}>
          {CLOTHING_PLATFORM_OPTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </label>
      <label className={label}>语言
        <select aria-label="语言" className={control} disabled={disabled || Boolean(fixedPlatformLanguage(value.platform))} value={value.language} onChange={(event) => onChange({ language: event.currentTarget.value as ClothingGenerationSettings["language"] })}>
          {LANGUAGE_OPTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </label>
      <label className={label}>图片比例
        <select aria-label="图片比例" className={control} disabled={disabled} value={value.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.currentTarget.value as ClothingGenerationSettings["aspectRatio"] })}>
          {CLOTHING_RATIO_OPTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </label>
      <label className={label}>生成数量
        <select aria-label="生成数量" className={control} disabled={disabled} value={value.imageCount} onChange={(event) => onChange({ imageCount: Number(event.currentTarget.value) })}>
          {Array.from({ length: 16 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 张</option>)}
        </select>
      </label>
      <label className={label}>图片质量
        <select aria-label="图片质量" className={control} disabled={disabled} value={value.quality} onChange={(event) => onChange({ quality: event.currentTarget.value as ClothingGenerationSettings["quality"] })}>
          {QUALITY_OPTIONS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </label>
      <label className={label}>自定义水印
        <input aria-label="自定义水印" className={control} maxLength={40} disabled={disabled} value={value.watermark} placeholder="可选，最多 40 字" onChange={(event) => onChange({ watermark: event.currentTarget.value })} />
      </label>
    </div>
  );
}
