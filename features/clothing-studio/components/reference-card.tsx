"use client";

import type { ReferenceAsset } from "../model";

type Props = {
  kind: "model" | "scene";
  value: ReferenceAsset | null;
  onUpload: () => void;
  onGenerate: () => void;
  onReselect?: () => void;
  onDelete: () => void;
  disabled?: boolean;
};

export function ReferenceCard({ kind, value, onUpload, onGenerate, onReselect, onDelete, disabled = false }: Props) {
  const name = kind === "model" ? "模特图" : "场景图";
  return (
    <section className="rounded-2xl border border-[#e0e2e7] bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{name}</p>
          <p className="mt-1 text-xs text-[#7a7f89]">{kind === "model" ? "必选 · 全组保持同一模特" : "可选 · 统一整组场景风格"}</p>
        </div>
        {value && <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs text-emerald-700">已选择</span>}
      </div>
      {value ? (
        <>
          {/* User-selected blob and signed local URLs cannot use Next image optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.previewUrl} alt={`已选${name}`} className="mt-3 h-44 w-full rounded-xl bg-[#f2f3f5] object-contain" />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={disabled} onClick={onReselect ?? onGenerate} aria-label={`重新选择${name}`} className="rounded-xl border border-[#d8dbe2] px-3 py-2 text-sm">重新选择</button>
            <button type="button" disabled={disabled} onClick={onDelete} aria-label={`删除${name}`} className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-600">删除</button>
          </div>
        </>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={disabled} onClick={onUpload} aria-label={`上传${name}`} className="rounded-xl border border-[#d8dbe2] px-3 py-3 text-sm">上传</button>
          <button type="button" disabled={disabled} onClick={onGenerate} aria-label={`AI 生成${name}`} className="rounded-xl bg-[#17191d] px-3 py-3 text-sm text-white">AI 生成</button>
        </div>
      )}
    </section>
  );
}
