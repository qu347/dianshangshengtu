"use client";

import type { GenerationSettings } from "../model";

export const PLATFORM_OPTIONS = [
  ["general", "通用电商"], ["taobao", "淘宝 / 天猫"], ["douyin", "抖音商城"], ["amazon", "Amazon"], ["shopify", "Shopify"],
] as const;
export const LANGUAGE_OPTIONS = [["none", "无文字"], ["zh-CN", "中文"], ["en", "英文"]] as const;
export const RATIO_OPTIONS = [["1024x1024", "1:1 正方形"], ["1024x1536", "2:3 竖版"], ["1536x1024", "3:2 横版"]] as const;

type GenerationSettingsFormProps = {
  value: GenerationSettings;
  onChange: (patch: Partial<GenerationSettings>) => void;
};

export function GenerationSettingsForm({ value, onChange }: GenerationSettingsFormProps) {
  return (
    <div>
      <label>
        平台
        <select aria-label="平台" value={value.platform} onChange={(event) => onChange({ platform: event.currentTarget.value as GenerationSettings["platform"] })}>
          {PLATFORM_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        语言
        <select aria-label="语言" value={value.language} onChange={(event) => onChange({ language: event.currentTarget.value as GenerationSettings["language"] })}>
          {LANGUAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        图片比例
        <select aria-label="图片比例" value={value.aspectRatio} onChange={(event) => onChange({ aspectRatio: event.currentTarget.value as GenerationSettings["aspectRatio"] })}>
          {RATIO_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        生成数量
        <select aria-label="生成数量" value={value.imageCount} onChange={(event) => onChange({ imageCount: Number(event.currentTarget.value) })}>
          {Array.from({ length: 16 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} 张</option>)}
        </select>
      </label>
    </div>
  );
}
