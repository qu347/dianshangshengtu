"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import type { GenerationTask, PlanItem } from "../model";

type ResultCardProps = {
  item: PlanItem;
  task: GenerationTask;
  onRetry: (item: PlanItem) => void;
  onContinuePolling: (task: GenerationTask) => void;
  onDownload: (task: GenerationTask) => void;
  busy?: boolean;
  downloadBusy?: boolean;
};

export function ResultCard({ item, task, onRetry, onContinuePolling, onDownload, busy = false, downloadBusy = false }: ResultCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = `result-title-${item.id}`;
  const imageLabel = `生成结果：${item.title}`;
  const isInProgress = task.status === "queued" || task.status === "submitting" || task.status === "running";
  const progressLabel = task.status === "queued" ? "等待生成" : task.status === "submitting" ? "正在提交" : "生成中";

  function closeDialog() {
    setDialogOpen(false);
    viewButtonRef.current?.focus();
  }

  return (
    <article className="rounded-lg border border-black/15 p-3" aria-labelledby={titleId}>
      <h3 id={titleId} className="font-medium">{item.title}</h3>
      <p className="mt-1 text-sm text-black/55">{item.objective}</p>

      {isInProgress && (
        <div className="mt-3">
          <p>{progressLabel}</p>
          <progress className="mt-2 w-full" max={100} value={task.progress}>{task.progress}%</progress>
        </div>
      )}

      {task.status === "succeeded" && task.resultUrl && (
        <div className="mt-3">
          <Image unoptimized width={1024} height={1024} className="aspect-square h-auto w-full rounded-lg object-contain" src={task.resultUrl} alt={imageLabel} />
          <div className="mt-3 flex gap-2">
            <button ref={viewButtonRef} className="rounded-lg border border-black/15 px-3 py-2" type="button" onClick={() => setDialogOpen(true)}>查看大图</button>
            <button className="rounded-lg bg-violet-700 px-3 py-2 text-white disabled:opacity-60" type="button" disabled={busy || downloadBusy || !task.downloadToken} onClick={() => onDownload(task)}>下载</button>
          </div>
        </div>
      )}

      {task.status === "failed" && (
        <div className="mt-3">
          <p className="text-red-700" role="alert">{task.error ?? "生成失败"}</p>
          <button className="mt-3 rounded-lg border border-black/15 px-3 py-2 disabled:opacity-60" type="button" disabled={busy} onClick={() => onRetry(item)}>重试此图</button>
        </div>
      )}

      {task.status === "timed_out" && (
        <div className="mt-3">
          <p>{task.error ?? "查询超时，任务仍可能在生成"}</p>
          <button className="mt-3 rounded-lg border border-black/15 px-3 py-2 disabled:opacity-60" type="button" disabled={busy || !task.providerJobId} onClick={() => onContinuePolling(task)}>继续查询</button>
        </div>
      )}

      {dialogOpen && task.status === "succeeded" && task.resultUrl && (
        <dialog open aria-label={imageLabel} className="m-auto max-h-[90vh] max-w-[90vw] rounded-xl p-4 backdrop:bg-black/60">
          <Image unoptimized width={1024} height={1024} className="h-auto max-h-[80vh] w-auto max-w-full object-contain" src={task.resultUrl} alt={imageLabel} />
          <button className="mt-3 rounded-lg border border-black/15 px-3 py-2" type="button" onClick={closeDialog}>关闭大图</button>
        </dialog>
      )}
    </article>
  );
}
