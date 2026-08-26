"use client";

import type { GenerationSettings, PlanItem, ProductAnalysis } from "../model";
import { GenerationPlanSchema } from "../lib/plan-rules";

type PlanEditorProps = {
  analysis: ProductAnalysis;
  settings: GenerationSettings;
  onChange: (analysis: ProductAnalysis) => void;
  onReplan: () => void;
  onConfirm: () => void;
  disabled?: boolean;
};

export function PlanEditor({ analysis, settings, onChange, onReplan, onConfirm, disabled = false }: PlanEditorProps) {
  function updateItem(index: number, patch: Partial<PlanItem>) {
    onChange({ ...analysis, plan: analysis.plan.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  }

  const canConfirm = GenerationPlanSchema(settings).safeParse(analysis.plan).success;
  const labelClass = "block text-xs font-medium text-[#5f646e]";
  const inputClass = "mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]";

  return (
    <section aria-labelledby="plan-editor-title" className="mt-5 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#7b808b]">IMAGE PLAN</p>
          <h2 id="plan-editor-title" className="mt-1 text-base font-semibold">生成规划</h2>
        </div>
        <span className="text-xs text-[#777c86]">共 {analysis.plan.length} 张，可逐项修改</span>
      </div>
      {analysis.plan.map((item, index) => (
        <article key={item.id} className="rounded-xl border border-[#e0e3e9] bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.03)]" aria-labelledby={`plan-item-${item.id}`}>
          <div className="flex items-center justify-between gap-3">
            <h3 id={`plan-item-${item.id}`} className="font-semibold text-[#292c32]">第 {String(index + 1).padStart(2, "0")} 张</h3>
            <span className="rounded-full bg-[#f1efff] px-2.5 py-1 text-xs text-[#6255b4]">{item.type === "main" ? "主图" : "详情图"}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>类型
            <select className={inputClass} disabled={disabled} value={item.type} onChange={(event) => updateItem(index, { type: event.currentTarget.value as PlanItem["type"] })}>
              <option value="main">主图</option>
              <option value="detail">详情图</option>
            </select>
          </label>
          <label className={labelClass}>标题
            <input className={inputClass} disabled={disabled} value={item.title} onChange={(event) => updateItem(index, { title: event.currentTarget.value })} />
          </label>
          <label className={labelClass}>画面目标
            <input className={inputClass} disabled={disabled} value={item.objective} onChange={(event) => updateItem(index, { objective: event.currentTarget.value })} />
          </label>
          <label className={labelClass}>文案
            <input className={inputClass} disabled={disabled} value={item.copy} onChange={(event) => updateItem(index, { copy: event.currentTarget.value })} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>场景
            <input className={inputClass} disabled={disabled} value={item.scene} onChange={(event) => updateItem(index, { scene: event.currentTarget.value })} />
          </label>
          <label className={`${labelClass} sm:col-span-2`}>第 {index + 1} 张中文生图提示词
            <textarea className="mt-1.5 block min-h-24 w-full resize-y rounded-lg border border-[#d8dbe2] bg-white px-3 py-2 text-sm leading-6 text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]" disabled={disabled} value={item.prompt} onChange={(event) => updateItem(index, { prompt: event.currentTarget.value })} />
          </label>
          {index === 1 && item.annotations.length > 0 && (
            <section className="rounded-lg bg-[#f7f7fb] p-3 sm:col-span-2" aria-labelledby={`plan-item-${item.id}-annotations`}>
              <h4 id={`plan-item-${item.id}-annotations`} className="text-xs font-semibold text-[#4f535c]">尺寸标注</h4>
              <ul className="mt-2 space-y-1.5" aria-label="尺寸标注">
                {item.annotations.map((annotation, annotationIndex) => (
                  <li key={`${annotation.label}-${annotationIndex}`} className="flex min-w-0 items-baseline justify-between gap-3 text-xs leading-5">
                    <span className="min-w-0 break-words text-[#6f747e]">{annotation.label}</span>
                    <span className="shrink-0 font-medium text-[#343840]">{annotation.displayValue}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          </div>
        </article>
      ))}
      <div className="flex flex-wrap justify-end gap-3 border-t border-[#e8eaee] pt-4">
        <button className="rounded-lg border border-[#d5d8df] bg-white px-4 py-2.5 text-sm font-medium text-[#343840] transition hover:bg-[#f6f7f9] disabled:opacity-50" type="button" disabled={disabled} onClick={onReplan}>重新规划</button>
        <button className="rounded-lg bg-[#17191d] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={onConfirm} disabled={disabled || !canConfirm}>确认规划并生成</button>
      </div>
    </section>
  );
}
