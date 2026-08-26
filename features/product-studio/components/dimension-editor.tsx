"use client";

import type { DimensionItem } from "../model";

type DimensionEditorProps = {
  value: DimensionItem[];
  imageCount: number;
  disabled?: boolean;
  onChange: (value: DimensionItem[]) => void;
};

const UNIT_OPTIONS = [
  ["mm", "毫米（mm）"],
  ["cm", "厘米（cm）"],
  ["m", "米（m）"],
  ["in", "英寸（in）"],
  ["ml", "毫升（mL）"],
  ["l", "升（L）"],
  ["custom", "自定义"],
] as const;

export function DimensionEditor({ value, imageCount, disabled = false, onChange }: DimensionEditorProps) {
  const inputClass = "mt-1 block h-9 w-full rounded-lg border border-[#d8dbe2] bg-white px-2.5 text-sm text-[#24272d] focus:border-[#8175e5] disabled:cursor-not-allowed disabled:bg-[#f3f4f6]";

  function updateRow(index: number, patch: Partial<DimensionItem>) {
    onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  return (
    <div className="mt-3 space-y-2.5">
      {value.length === 0 && imageCount >= 2 && (
        <p className="text-xs text-red-600">生成 2 张及以上时至少填写 1 个产品尺寸</p>
      )}
      {value.map((item, index) => {
        const rowNumber = index + 1;
        const labelError = !item.label.trim();
        const valueError = !Number.isFinite(item.value) || item.value <= 0;
        const customUnitError = item.unit === "custom" && !item.customUnit?.trim();
        return (
          <div key={item.id} className="rounded-xl border border-[#e4e7ec] bg-[#fafbfc] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#676c76]">尺寸项 {rowNumber}</span>
              <button className="text-xs text-[#7770bd] disabled:cursor-not-allowed disabled:text-[#a4a7ae]" type="button" aria-label={`删除尺寸项 ${rowNumber}`} disabled={disabled} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>删除</button>
            </div>
            <label className="mt-2 block text-xs font-medium text-[#5f646e]">
              名称
              <input className={inputClass} aria-label={`尺寸名称 ${rowNumber}`} disabled={disabled} value={item.label} onChange={(event) => updateRow(index, { label: event.currentTarget.value })} />
            </label>
            {labelError && <p className="mt-1 text-xs text-red-600">请填写尺寸名称</p>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block text-xs font-medium text-[#5f646e]">
                数值
                <input className={inputClass} aria-label={`尺寸数值 ${rowNumber}`} type="number" min="0" step="any" disabled={disabled} value={item.value || ""} onChange={(event) => updateRow(index, { value: Number(event.currentTarget.value) })} />
              </label>
              <label className="block text-xs font-medium text-[#5f646e]">
                单位
                <select className={inputClass} aria-label={`尺寸单位 ${rowNumber}`} disabled={disabled} value={item.unit} onChange={(event) => {
                  const unit = event.currentTarget.value as DimensionItem["unit"];
                  updateRow(index, unit === "custom" ? { unit } : { unit, customUnit: undefined });
                }}>
                  {UNIT_OPTIONS.map(([unit, label]) => <option key={unit} value={unit}>{label}</option>)}
                </select>
              </label>
            </div>
            {valueError && <p className="mt-1 text-xs text-red-600">尺寸数值必须大于 0</p>}
            {item.unit === "custom" && (
              <label className="mt-2 block text-xs font-medium text-[#5f646e]">
                自定义单位
                <input className={inputClass} aria-label={`自定义单位 ${rowNumber}`} maxLength={12} disabled={disabled} value={item.customUnit ?? ""} onChange={(event) => updateRow(index, { customUnit: event.currentTarget.value })} />
              </label>
            )}
            {customUnitError && <p className="mt-1 text-xs text-red-600">请填写自定义单位</p>}
          </div>
        );
      })}
      <button className="w-full rounded-lg border border-dashed border-[#cfd2da] px-3 py-2 text-xs font-medium text-[#6255b4] disabled:cursor-not-allowed disabled:text-[#a4a7ae]" type="button" aria-label="添加尺寸项" disabled={disabled || value.length >= 6} onClick={() => onChange([...value, { id: crypto.randomUUID(), label: "", value: 0, unit: "cm" }])}>
        + 添加尺寸项
      </button>
    </div>
  );
}
