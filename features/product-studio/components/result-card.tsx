"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { GenerationTask, PlanItem } from "../model";

type ResultCardProps = {
  item: PlanItem;
  task: GenerationTask;
  onRetry: (item: PlanItem) => void;
  onContinuePolling: (task: GenerationTask) => void;
  onDownload: (task: GenerationTask) => void;
  busy?: boolean;
  retrying?: boolean;
  downloadBusy?: boolean;
};

export function ResultCard({ item, task, onRetry, onContinuePolling, onDownload, busy = false, retrying = false, downloadBusy = false }: ResultCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = `result-title-${item.id}`;
  const imageLabel = `生成结果：${item.title}`;
  const typeLabel = item.title === "白底商品主图" || item.title === "尺寸标注图"
    ? item.title
    : item.type === "main" ? "主图" : "详情图";
  const isInProgress = task.status === "queued" || task.status === "submitting" || task.status === "running";
  const progressLabel = task.status === "queued" ? "等待生成" : task.status === "submitting" ? retrying ? "正在重新提交…" : "正在提交" : "生成中";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialogOpen && dialog && !dialog.open) dialog.showModal();
  }, [dialogOpen]);

  function handleDialogClosed() {
    setDialogOpen(false);
    viewButtonRef.current?.focus();
  }

  return (
    <article className="overflow-hidden rounded-xl border border-[#dfe2e8] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]" aria-labelledby={titleId}>
      <header className="border-b border-[#eceef2] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="font-semibold text-[#292c32]">{item.title}</h3>
            <p className="mt-1 text-xs leading-5 text-[#777c86]">{item.objective}</p>
          </div>
          <span className="shrink-0 rounded-full bg-[#f1efff] px-2 py-1 text-[11px] text-[#6255b4]">{typeLabel}</span>
        </div>
      </header>

      {isInProgress && (
        <div className="flex min-h-56 flex-col items-center justify-center bg-[#fafbfc] px-5 py-8 text-center">
          <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-[#eeebff] text-[#675ab8]">•••</span>
          <p className="mt-3 text-sm font-medium text-[#343840]">{progressLabel}</p>
          <progress aria-label={`${item.title}生成进度`} className="mt-3 h-2 w-full max-w-64 overflow-hidden rounded-full" max={100} value={task.progress}>{task.progress}%</progress>
          <p className="mt-2 text-xs text-[#8a8f99]">生图通常需要几分钟，请保持页面打开</p>
        </div>
      )}

      {task.status === "succeeded" && task.resultUrl && (
        <div>
          <div className="bg-[#f3f4f6] p-3">
            <Image unoptimized width={1024} height={1024} className="aspect-[4/5] h-auto w-full rounded-lg bg-white object-contain" src={task.resultUrl} alt={imageLabel} />
          </div>
          <div className="flex gap-2 px-4 py-3">
            <button ref={viewButtonRef} className="flex-1 rounded-lg border border-[#d5d8df] bg-white px-3 py-2 text-sm font-medium text-[#343840] transition hover:bg-[#f6f7f9]" type="button" onClick={() => setDialogOpen(true)}>查看大图</button>
            <button className="flex-1 rounded-lg bg-[#6d5ce7] px-3 py-2 text-sm font-medium text-white transition hover:bg-[#5d4dd0] disabled:opacity-50" type="button" disabled={busy || downloadBusy || !task.downloadToken} onClick={() => onDownload(task)}>下载</button>
          </div>
        </div>
      )}

      {task.status === "failed" && (
        <div className="min-h-56 bg-red-50/60 px-4 py-5">
          <span className="inline-flex rounded-full bg-red-100 px-2.5 py-1 text-xs font-medium text-red-700">生成失败</span>
          <p className="mt-3 text-sm leading-6 text-red-700" role="alert">{task.error ?? "生成失败"}</p>
          <button className="mt-4 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={busy} onClick={() => onRetry(item)}>重试此图</button>
          {busy && <p className="mt-2 text-xs leading-5 text-[#777c86]">当前批次生成中，完成后可重试</p>}
        </div>
      )}

      {task.status === "timed_out" && (
        <div className="min-h-56 bg-amber-50/60 px-4 py-5">
          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">等待结果</span>
          <p className="mt-3 text-sm leading-6 text-amber-900">{task.error ?? "查询超时，任务仍可能在生成"}</p>
          <button className="mt-4 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-50 disabled:opacity-50" type="button" disabled={busy || !task.providerJobId} onClick={() => onContinuePolling(task)}>继续查询</button>
        </div>
      )}

      {dialogOpen && task.status === "succeeded" && task.resultUrl && (
        <dialog ref={dialogRef} aria-modal="true" aria-label={imageLabel} onClose={handleDialogClosed} className="fixed inset-0 z-50 m-auto max-h-[92vh] w-[min(900px,94vw)] rounded-2xl border-0 bg-white p-4 shadow-2xl backdrop:bg-black/70">
          <div className="flex justify-end"><button className="rounded-full bg-[#f1f2f4] px-3 py-1.5 text-sm font-medium" type="button" onClick={() => dialogRef.current?.close()}>关闭大图</button></div>
          <Image unoptimized width={1024} height={1024} className="mt-3 h-auto max-h-[78vh] w-full object-contain" src={task.resultUrl} alt={imageLabel} />
        </dialog>
      )}
    </article>
  );
}
