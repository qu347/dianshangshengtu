"use client";

import { useRef, useState } from "react";
import type { ClothingGenerationTask, ClothingPlanItem } from "../model";

type Props = {
  items: ClothingPlanItem[];
  tasks: ClothingGenerationTask[];
  onRetry: (item: ClothingPlanItem) => void;
  onContinuePolling: (task: ClothingGenerationTask) => void;
  onDownload: (task: ClothingGenerationTask) => void;
  onDownloadAll: () => void;
  recovered?: boolean;
  busy?: boolean;
};

export function ClothingResultGrid({ items, tasks, onRetry, onContinuePolling, onDownload, onDownloadAll, recovered = false, busy = false }: Props) {
  const [preview, setPreview] = useState<{ item: ClothingPlanItem; task: ClothingGenerationTask } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const canDownloadAll = tasks.some((task) => task.status === "succeeded" && task.downloadToken);

  function closePreview() {
    setPreview(null);
    triggerRef.current?.focus();
  }

  return (
    <section aria-labelledby="clothing-results-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#838892]">GENERATED ASSETS</p>
          <h2 id="clothing-results-title" className="mt-1 text-base font-semibold">生成结果</h2>
        </div>
        <button type="button" disabled={!canDownloadAll || busy} onClick={onDownloadAll} className="rounded-xl bg-[#17191d] px-4 py-2.5 text-sm text-white disabled:opacity-40">下载全部</button>
      </div>
      <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">单张生成可能需要几分钟；结果链接为临时链接，请及时下载保存。</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {items.map((item) => {
          const task = tasks.find((candidate) => candidate.planItemId === item.id) ?? {
            planItemId: item.id, status: "queued" as const, progress: 0,
          };
          return (
            <article key={item.id} className="overflow-hidden rounded-2xl border border-[#e0e2e7] bg-white">
              <header className="border-b border-[#eceef1] px-4 py-3">
                <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">{item.title}</h3><span className="text-xs text-[#777c86]">第 {item.id} 张</span></div>
                <p className="mt-1 text-xs text-[#777c86]">{item.objective}</p>
              </header>
              <div className="flex min-h-72 flex-col justify-center bg-[#f7f7f8] p-3">
                {task.status === "succeeded" && task.resultUrl ? (
                  // Signed local preview URLs cannot use Next image optimization.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={task.resultUrl} alt={item.title} className="h-72 w-full object-contain" />
                ) : task.status === "failed" ? (
                  <div className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
                    <p>{task.error}</p>
                    {recovered && <p className="mt-2 text-xs">重新上传服装和模特后可重试</p>}
                  </div>
                ) : (
                  <div className="text-center text-sm text-[#707580]">
                    <p>{task.status === "timed_out" ? "查询暂时中断" : task.status === "queued" ? "等待生成" : "正在生成"}</p>
                    <progress className="mt-3 w-48" max={100} value={task.progress} />
                  </div>
                )}
              </div>
              <footer className="flex flex-wrap gap-2 border-t border-[#eceef1] p-3">
                {task.status === "succeeded" && task.downloadToken && <>
                  <button ref={(element) => { if (element) triggerRef.current = element; }} type="button" aria-label={`查看第 ${item.id} 张大图`} onClick={(event) => { triggerRef.current = event.currentTarget; setPreview({ item, task }); }} className="rounded-xl border border-[#d7dae1] px-3 py-2 text-sm">查看大图</button>
                  <button type="button" aria-label={`下载第 ${item.id} 张`} onClick={() => onDownload(task)} className="rounded-xl bg-[#6d5ce7] px-3 py-2 text-sm text-white">下载</button>
                </>}
                {task.status === "failed" && <button type="button" aria-label={`重试第 ${item.id} 张`} disabled={busy || recovered} onClick={() => onRetry(item)} className="rounded-xl border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-40">重试此图</button>}
                {task.status === "timed_out" && task.providerJobId && <button type="button" aria-label={`继续查询第 ${item.id} 张`} disabled={busy} onClick={() => onContinuePolling(task)} className="rounded-xl border border-[#d7dae1] px-3 py-2 text-sm">继续查询</button>}
              </footer>
            </article>
          );
        })}
      </div>
      {preview && (
        <dialog open aria-modal="true" aria-label={`第 ${preview.item.id} 张大图`} className="fixed inset-0 z-50 m-auto max-h-[92vh] w-[min(900px,94vw)] rounded-2xl border-0 bg-white p-4 shadow-2xl backdrop:bg-black/70">
          <div className="flex justify-end"><button type="button" aria-label="关闭大图" onClick={closePreview} className="rounded-full bg-[#f1f2f4] px-3 py-1.5">关闭</button></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.task.resultUrl} alt={`${preview.item.title}大图`} className="mt-3 max-h-[78vh] w-full object-contain" />
        </dialog>
      )}
    </section>
  );
}
