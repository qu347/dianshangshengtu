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
};

export function GenerationGrid({ items, tasks, onRetry, onContinuePolling, onDownload, onDownloadAll }: GenerationGridProps) {
  const canDownloadAll = tasks.some((task) => task.status === "succeeded" && task.downloadToken);

  return (
    <section aria-labelledby="generation-results-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="generation-results-title" className="font-medium">生成结果</h2>
        <button className="rounded-lg bg-violet-700 px-4 py-2 text-white disabled:opacity-60" type="button" disabled={!canDownloadAll} onClick={onDownloadAll}>下载全部</button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <ResultCard
            key={item.id}
            item={item}
            task={tasks.find((task) => task.planItemId === item.id) ?? { planItemId: item.id, status: "queued", progress: 0 }}
            onRetry={onRetry}
            onContinuePolling={onContinuePolling}
            onDownload={onDownload}
          />
        ))}
      </div>
    </section>
  );
}
