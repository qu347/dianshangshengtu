"use client";

import type { ClothingAnalysis, ClothingGenerationSettings, ClothingPlanItem } from "../model";
import { ClothingGenerationPlanSchema } from "../lib/plan-rules";

type Props = {
  analysis: ClothingAnalysis;
  settings: ClothingGenerationSettings;
  onChange: (analysis: ClothingAnalysis) => void;
  onReplan: () => void;
  onConfirm: () => void;
  disabled?: boolean;
};

const typeLabels = {
  product: "白底立体主图",
  model: "模特展示",
  scene: "场景展示",
  detail: "细节特写",
} as const;

export function ClothingPlanEditor({ analysis, settings, onChange, onReplan, onConfirm, disabled = false }: Props) {
  function updateItem(index: number, patch: Partial<ClothingPlanItem>) {
    onChange({
      ...analysis,
      plan: analysis.plan.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    });
  }
  const valid = ClothingGenerationPlanSchema(settings).safeParse(analysis.plan).success;
  const control = "mt-1.5 h-10 w-full rounded-xl border border-[#d9dce3] bg-white px-3 text-sm disabled:bg-[#f2f3f5]";
  const label = "block text-xs font-medium text-[#626772]";

  return (
    <section className="mt-5 space-y-4" aria-labelledby="clothing-plan-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#838892]">IMAGE PLAN</p>
          <h2 id="clothing-plan-title" className="mt-1 text-base font-semibold">生成规划</h2>
        </div>
        <span className="text-xs text-[#7a7f89]">共 {analysis.plan.length} 张，可逐项修改</span>
      </div>
      {analysis.plan.map((item, index) => (
        <article key={item.id} className="rounded-2xl border border-[#e0e2e7] bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">第 {String(index + 1).padStart(2, "0")} 张</h3>
            <span className="rounded-full bg-[#f0efff] px-2.5 py-1 text-xs text-[#6458b2]">{typeLabels[item.type]}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={label}>类型
              <select aria-label={`第 ${index + 1} 张类型`} className={control} disabled={disabled || index === 0} value={item.type} onChange={(event) => updateItem(index, { type: event.currentTarget.value as ClothingPlanItem["type"] })}>
                <option value="product">白底立体主图</option><option value="model">模特展示</option><option value="scene">场景展示</option><option value="detail">细节特写</option>
              </select>
            </label>
            <label className={label}>标题<input className={control} disabled={disabled} value={item.title} onChange={(event) => updateItem(index, { title: event.currentTarget.value })} /></label>
            <label className={label}>画面目标<input className={control} disabled={disabled} value={item.objective} onChange={(event) => updateItem(index, { objective: event.currentTarget.value })} /></label>
            <label className={label}>营销文案<input className={control} disabled={disabled || index === 0} value={item.copy} onChange={(event) => updateItem(index, { copy: event.currentTarget.value })} /></label>
            <label className={`${label} sm:col-span-2`}>场景<input className={control} disabled={disabled || index === 0} value={item.scene} onChange={(event) => updateItem(index, { scene: event.currentTarget.value })} /></label>
            <label className={`${label} sm:col-span-2`}>第 {index + 1} 张中文生图提示词
              <textarea aria-label={`第 ${index + 1} 张中文生图提示词`} className="mt-1.5 min-h-24 w-full rounded-xl border border-[#d9dce3] bg-white p-3 text-sm leading-6 disabled:bg-[#f2f3f5]" disabled={disabled || index === 0} value={item.prompt} onChange={(event) => updateItem(index, { prompt: event.currentTarget.value })} />
            </label>
          </div>
        </article>
      ))}
      <div className="flex justify-end gap-3 border-t border-[#e8eaee] pt-4">
        <button type="button" disabled={disabled} onClick={onReplan} className="rounded-xl border border-[#d6d9e0] px-4 py-2.5 text-sm">重新规划</button>
        <button type="button" disabled={disabled || !valid} onClick={onConfirm} className="rounded-xl bg-[#17191d] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">确认规划并生成</button>
      </div>
    </section>
  );
}
