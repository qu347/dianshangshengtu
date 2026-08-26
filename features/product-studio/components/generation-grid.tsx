"use client";

import type { GenerationTask, PlanItem } from "../model";
import { ResultCard } from "./result-card";

type GenerationGridProps = {
  items: PlanItem[];
  tasks: GenerationTask[];
  onRetry: (item: PlanItem) => void;
  onContinuePolling: (task: GenerationTask) => void;
  onDownload: (task: GenerationTask) => void;
  onDownloadAll: () => void;
  busy?: boolean;
  retryingItemId?: string | null;
  downloadBusy?: boolean;
};

export function GenerationGrid({ items, tasks, onRetry, onContinuePolling, onDownload, onDownloadAll, busy = false, retryingItemId = null, downloadBusy = false }: GenerationGridProps) {
  const canDownloadAll = tasks.some((task) => task.status === "succeeded" && task.downloadToken);

  return (
    <section aria-labelledby="generation-results-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#7b808b]">GENERATED ASSETS</p>
          <h2 id="generation-results-title" className="mt-1 text-base font-semibold">生成结果</h2>
        </div>
        <button className="rounded-lg bg-[#17191d] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={busy || downloadBusy || !canDownloadAll} onClick={onDownloadAll}>下载全部</button>
      </div>
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">结果链接为临时链接，请在当前会话内及时下载保存。</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <ResultCard
            key={item.id}
            item={item}
            task={tasks.find((task) => task.planItemId === item.id) ?? { planItemId: item.id, status: "queued", progress: 0 }}
            onRetry={onRetry}
            onContinuePolling={onContinuePolling}
            onDownload={onDownload}
            busy={busy}
            retrying={retryingItemId === item.id}
            downloadBusy={downloadBusy}
          />
        ))}
      </div>
    </section>
  );
}
