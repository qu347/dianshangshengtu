"use client";

import { PlanItemSchema, type PlanItem, type ProductAnalysis } from "../model";

type PlanEditorProps = {
  analysis: ProductAnalysis;
  onChange: (analysis: ProductAnalysis) => void;
  onReplan: () => void;
  onConfirm: () => void;
  disabled?: boolean;
};

export function PlanEditor({ analysis, onChange, onReplan, onConfirm, disabled = false }: PlanEditorProps) {
  function updateItem(index: number, patch: Partial<PlanItem>) {
    onChange({ ...analysis, plan: analysis.plan.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  }

  const canConfirm = analysis.plan.every((item) => PlanItemSchema.safeParse(item).success);

  return (
    <div className="mt-5 space-y-4">
      <h2 className="font-medium">生成规划</h2>
      {analysis.plan.map((item, index) => (
        <article key={item.id} className="rounded-lg border border-black/15 p-3" aria-labelledby={`plan-item-${item.id}`}>
          <h3 id={`plan-item-${item.id}`} className="font-medium">第 {index + 1} 张</h3>
          <label className="mt-3 block">类型
            <select className="mt-1 block w-full rounded border border-black/15 p-2" disabled={disabled} value={item.type} onChange={(event) => updateItem(index, { type: event.currentTarget.value as PlanItem["type"] })}>
              <option value="main">主图</option>
              <option value="detail">详情图</option>
            </select>
          </label>
          <label className="mt-3 block">标题
            <input className="mt-1 block w-full rounded border border-black/15 p-2" disabled={disabled} value={item.title} onChange={(event) => updateItem(index, { title: event.currentTarget.value })} />
          </label>
          <label className="mt-3 block">画面目标
            <input className="mt-1 block w-full rounded border border-black/15 p-2" disabled={disabled} value={item.objective} onChange={(event) => updateItem(index, { objective: event.currentTarget.value })} />
          </label>
          <label className="mt-3 block">文案
            <input className="mt-1 block w-full rounded border border-black/15 p-2" disabled={disabled} value={item.copy} onChange={(event) => updateItem(index, { copy: event.currentTarget.value })} />
          </label>
          <label className="mt-3 block">场景
            <input className="mt-1 block w-full rounded border border-black/15 p-2" disabled={disabled} value={item.scene} onChange={(event) => updateItem(index, { scene: event.currentTarget.value })} />
          </label>
          <label className="mt-3 block">第 {index + 1} 张生图提示词
            <textarea className="mt-1 block w-full rounded border border-black/15 p-2" disabled={disabled} value={item.prompt} onChange={(event) => updateItem(index, { prompt: event.currentTarget.value })} />
          </label>
        </article>
      ))}
      <div className="flex gap-3">
        <button className="rounded-lg border border-black/15 px-4 py-2" type="button" disabled={disabled} onClick={onReplan}>重新规划</button>
        <button className="rounded-lg bg-violet-700 px-4 py-2 text-white disabled:opacity-60" type="button" onClick={onConfirm} disabled={disabled || !canConfirm}>确认规划并生成</button>
      </div>
    </div>
  );
}
