"use client";

import type { GenerationSettings } from "../model";
import { fixedPlatformLanguage, settingsPatchForPlatform } from "../lib/platform-rules";

export const PLATFORM_OPTIONS = [
  ["general", "通用电商"], ["taobao", "淘宝 / 天猫"], ["douyin", "抖音商城"], ["amazon", "Amazon"], ["shopify", "Shopify"], ["ozon", "Ozon"],
] as const;
export const LANGUAGE_OPTIONS = [["none", "无营销文案"], ["zh-CN", "中文"], ["en", "英文"], ["ru", "俄文"]] as const;
export const RATIO_OPTIONS = [["1024x1024", "1:1 正方形"], ["1024x1536", "2:3 竖版"], ["1536x1024", "3:2 横版"], ["1090x1443", "3:4 竖版（1090×1443）"]] as const;

type GenerationSettingsFormProps = {
  value: GenerationSettings;
  onChange: (patch: Partial<GenerationSettings>) => void;
  disabled?: boolean;
};

export function GenerationSettingsForm({ value, onChange, disabled = false }: GenerationSettingsFormProps) {
  const labelClass = "block text-xs font-medium text-[#5f646e]";
  const selectClass = "mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm text-[#24272d] transition focus:border-[#8175e5] disabled:cursor-not-allowed disabled:bg-[#f3f4f6] disabled:text-[#9a9ea7]";

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className={labelClass}>
        平台
        <select className={selectClass} aria-label="平台" disabled={disabled} value={value.platform} onChange={(event) => onChange(settingsPatchForPlatform(event.currentTarget.value as GenerationSettings["platform"], value.language))}>
          {PLATFORM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        语言
        <select className={selectClass} aria-label="语言" disabled={disabled || Boolean(fixedPlatformLanguage(value.platform))} value={value.language} onChange={(event) => onChange({ language: event.currentTarget.value as GenerationSettings["language"] })}>
          {LANGUAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        图片比例
        <select className={selectClass} aria-label="图片比例" disabled={disabled} value={value.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.currentTarget.value as GenerationSettings["aspectRatio"] })}>
          {RATIO_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        生成数量
        <select className={selectClass} aria-label="生成数量" disabled={disabled} value={value.imageCount} onChange={(event) => onChange({ imageCount: Number(event.currentTarget.value) })}>
          {Array.from({ length: 16 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 张</option>)}
        </select>
      </label>
      <label className={`${labelClass} col-span-2`}>
        文字水印
        <input className={selectClass} aria-label="文字水印" maxLength={40} disabled={disabled} value={value.watermark} placeholder="可选，最多 40 个字符" onChange={(event) => onChange({ watermark: event.currentTarget.value })} />
      </label>
    </div>
  );
}
