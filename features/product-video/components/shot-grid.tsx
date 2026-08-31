"use client";

import type { IntroScript, VideoIntroTask } from "../model";

type ShotGridProps = {
  script: IntroScript;
  tasks: VideoIntroTask[];
  busy?: boolean;
  downloadBusy?: boolean;
  onRetry: (task: VideoIntroTask) => void;
  onDownload: (task: VideoIntroTask) => void;
  onDownloadAll: () => void;
  onDownloadMerged: () => void;
};

export function ShotGrid({ script, tasks, busy = false, downloadBusy = false, onRetry, onDownload, onDownloadAll, onDownloadMerged }: ShotGridProps) {
  const canDownloadAll = tasks.some((task) => task.status === "succeeded" && task.downloadToken);
  const succeededCount = tasks.filter((task) => task.status === "succeeded" && task.downloadToken).length;

  return (
    <section aria-labelledby="intro-results-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#7b808b]">GENERATED VIDEO</p>
          <h2 id="intro-results-title" className="mt-1 text-base font-semibold">生成结果</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {succeededCount >= 2 && (
            <button className="rounded-lg bg-[#6d5ce7] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#5b4ad1] disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={busy || downloadBusy} onClick={onDownloadMerged}>下载合并视频</button>
          )}
          <button className="rounded-lg bg-[#17191d] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={busy || downloadBusy || !canDownloadAll} onClick={onDownloadAll}>下载全部</button>
        </div>
      </div>
      <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">结果链接为临时链接，请在当前会话内及时下载保存。多个镜头可用「下载合并视频」按顺序拼接为一个完整视频。</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {script.shots.map((shot) => {
          const task = tasks.find((item) => item.shotId === shot.id) ?? { shotId: shot.id, status: "queued" as const, progress: 0 };
          const inProgress = task.status === "queued" || task.status === "submitting" || task.status === "running";
          const statusLabel = task.status === "queued" ? "等待生成" : task.status === "submitting" ? "正在提交" : "生成中";
          return (
            <article key={shot.id} className="overflow-hidden rounded-xl border border-[#dfe2e8] bg-white" aria-labelledby={`intro-result-${shot.id}`}>
              <header className="border-b border-[#eceef2] px-4 py-3">
                <h3 id={`intro-result-${shot.id}`} className="font-semibold text-[#292c32]">第 {shot.id.padStart(2, "0")} 镜 · {shot.title}</h3>
              </header>
              {inProgress && (
                <div className="flex min-h-48 flex-col items-center justify-center bg-[#fafbfc] px-5 py-8 text-center">
                  <p className="text-sm font-medium text-[#343840]">{statusLabel}</p>
                  <progress aria-label={`第 ${shot.id} 镜生成进度`} className="mt-3 h-2 w-full max-w-56" max={100} value={task.progress}>{task.progress}%</progress>
                </div>
              )}
              {task.status === "succeeded" && task.resultUrl && (
                <div className="p-3">
                  <video controls preload="metadata" src={task.resultUrl} className="w-full rounded-lg bg-black" aria-label={`第 ${shot.id} 镜视频预览`} />
                  <div className="mt-2 flex gap-2 px-1 pb-1">
                    {task.keyframeUrl && (
                      <a className="flex-1 rounded-lg border border-[#d5d8df] bg-white px-3 py-2 text-center text-sm font-medium text-[#343840] hover:bg-[#f6f7f9]" href={task.keyframeUrl} target="_blank" rel="noreferrer">查看关键帧</a>
                    )}
                    <button className="flex-1 rounded-lg bg-[#6d5ce7] px-3 py-2 text-sm font-medium text-white disabled:opacity-50" type="button" disabled={busy || downloadBusy || !task.downloadToken} onClick={() => onDownload(task)}>下载视频</button>
                  </div>
                </div>
              )}
              {task.status === "failed" && (
                <div className="min-h-40 bg-red-50/60 px-4 py-5">
                  <p className="text-sm leading-6 text-red-700" role="alert">{task.error ?? "生成失败"}</p>
                  <button className="mt-3 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50" type="button" disabled={busy} onClick={() => onRetry(task)}>重试此镜头</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
