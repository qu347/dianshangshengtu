"use client";

import { useReducer, useRef, useState } from "react";
import { analyzeProductClient, getGenerationStatusClient, submitGenerationClient, type ProductStudioApi } from "../lib/client-api";
import { downloadAllResults, downloadResult } from "../lib/downloads";
import { pollGenerationJob, runGenerationBatch } from "../lib/generation-runner";
import type { GenerationTask, PlanItem } from "../model";
import { initialProductStudioState, productStudioReducer } from "../state";
import { AnalysisPanel } from "./analysis-panel";
import { GenerationGrid } from "./generation-grid";
import { GenerationSettingsForm } from "./generation-settings";
import { ImageUploader } from "./image-uploader";
import { PlanEditor } from "./plan-editor";

const steps = ["上传", "AI 分析", "确认规划", "生成", "完成"];
const activeSteps = { input: 0, analyzing: 1, reviewing_plan: 2, submitting: 3, generating: 3, completed: 4 } as const;
const phaseLabels = { input: "准备素材", analyzing: "AI 分析中", reviewing_plan: "确认规划", submitting: "正在提交", generating: "批量生成中", completed: "任务完成" } as const;
const defaultProductStudioApi: ProductStudioApi = {
  analyze: analyzeProductClient,
  submit: submitGenerationClient,
  status: getGenerationStatusClient,
};

export function ProductStudio({ api = defaultProductStudioApi }: { api?: ProductStudioApi }) {
  const [state, dispatch] = useReducer(productStudioReducer, initialProductStudioState);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [retryingItemId, setRetryingItemId] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const analysisBusyRef = useRef(false);
  const analysisEpochRef = useRef(0);
  const generationBusyRef = useRef(false);
  const generationEpochRef = useRef(0);
  const downloadBusyRef = useRef(false);
  const activeStep = activeSteps[state.phase];
  const inputsDisabled = analysisBusy || generationBusy;

  function invalidateAnalysis() {
    analysisEpochRef.current += 1;
  }

  async function handleAnalyze() {
    if (analysisBusyRef.current || generationBusyRef.current) return;
    if (state.files.length === 0) {
      dispatch({ type: "analysis_failed", message: "请至少上传 1 张产品图" });
      return;
    }

    const operationId = ++analysisEpochRef.current;
    analysisBusyRef.current = true;
    setAnalysisBusy(true);
    dispatch({ type: "analysis_started" });
    try {
      const analysis = await api.analyze({
        files: state.files,
        settings: state.settings,
        productName: state.productName,
        requirements: state.requirements,
      });
      if (operationId === analysisEpochRef.current) {
        dispatch({ type: "analysis_succeeded", analysis });
      }
    } catch (error) {
      if (operationId === analysisEpochRef.current) {
        dispatch({ type: "analysis_failed", message: error instanceof Error ? error.message : "分析失败，请稍后重试" });
      }
    } finally {
      analysisBusyRef.current = false;
      setAnalysisBusy(false);
    }
  }

  async function runGenerationOperation(operation: (operationId: number) => Promise<void>) {
    if (analysisBusyRef.current || generationBusyRef.current) return;
    const operationId = ++generationEpochRef.current;
    generationBusyRef.current = true;
    setGenerationBusy(true);
    try {
      await operation(operationId);
      if (operationId === generationEpochRef.current) {
        dispatch({ type: "generation_completed" });
      }
    } finally {
      generationBusyRef.current = false;
      setGenerationBusy(false);
    }
  }

  async function handleGenerate() {
    const analysis = state.analysis;
    if (!analysis) return;
    await runGenerationOperation(async (operationId) => {
      dispatch({
        type: "generation_started",
        tasks: analysis.plan.map((item) => ({ planItemId: item.id, status: "queued", progress: 0 })),
      });
      await runGenerationBatch({
        items: analysis.plan,
        files: state.files,
        settings: state.settings,
        api,
        onTaskChange: (task) => {
          if (operationId === generationEpochRef.current) dispatch({ type: "task_changed", task });
        },
      });
    });
  }

  async function handleRetry(item: PlanItem) {
    await runGenerationOperation(async (operationId) => {
      setRetryingItemId(item.id);
      try {
        await runGenerationBatch({
          items: [item],
          files: state.files,
          settings: state.settings,
          api,
          onTaskChange: (task) => {
            if (operationId === generationEpochRef.current) dispatch({ type: "task_changed", task });
          },
        });
      } finally {
        setRetryingItemId(null);
      }
    });
  }

  async function handleContinuePolling(task: GenerationTask) {
    if (!task.providerJobId) return;
    await runGenerationOperation(async (operationId) => {
      await pollGenerationJob({
        providerJobId: task.providerJobId!,
        planItemId: task.planItemId,
        api,
        onTaskChange: (next) => {
          if (operationId === generationEpochRef.current) dispatch({ type: "task_changed", task: next });
        },
      });
    });
  }

  async function runDownload(operation: () => Promise<void>, fallbackMessage: string) {
    if (downloadBusyRef.current) return;
    downloadBusyRef.current = true;
    setDownloadBusy(true);
    setDownloadNotice(null);
    try {
      await operation();
    } catch (error) {
      setDownloadNotice(error instanceof Error ? error.message : fallbackMessage);
    } finally {
      downloadBusyRef.current = false;
      setDownloadBusy(false);
    }
  }

  return (
    <section className="px-4 py-6 md:px-8 md:py-8" aria-labelledby="studio-title">
      <div className="mx-auto max-w-[1320px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b808b]">PRODUCT VISUAL WORKFLOW</p>
            <h1 id="studio-title" className="mt-1 text-2xl font-bold tracking-tight text-[#17191d] md:text-[30px] md:leading-10">商品视觉工作台</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#666b75]">从产品分析到批量生成，在一个工作台完成整套电商视觉。</p>
          </div>
          <span className="rounded-full bg-[#ebe8ff] px-3 py-2 text-xs font-medium text-[#5d51a8]">全品类商品图</span>
        </header>

        <ol aria-label="任务进度" className="mt-5 grid gap-2 rounded-2xl border border-[#e3e6eb] bg-white p-2 shadow-[0_1px_2px_rgba(16,24,40,0.03)] sm:grid-cols-5">
          {steps.map((label, index) => {
            const isActive = index === activeStep;
            const isComplete = index < activeStep;
            return (
              <li
                key={label}
                aria-current={isActive ? "step" : undefined}
                className={isActive ? "flex items-center gap-2 rounded-xl bg-[#eeebff] px-3 py-2.5 text-[#5f52aa]" : "flex items-center gap-2 rounded-xl px-3 py-2.5 text-[#767b85]"}
              >
                <span className={isActive ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#6d5ce7] text-[11px] font-semibold text-white" : isComplete ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#dcfce7] text-[11px] font-semibold text-emerald-700" : "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#f0f1f3] text-[11px] font-semibold text-[#7b808a]"}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{label}</span>
                  <span className="mt-0.5 block text-[10px] opacity-70">{isActive ? "进行中" : isComplete ? "已完成" : "待开始"}</span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-2xl border border-[#e0e3e9] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]" aria-labelledby="project-config-title">
            <header className="border-b border-[#e9ebef] px-5 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#858a94]">PROJECT BRIEF</p>
              <h2 id="project-config-title" className="mt-1 text-base font-semibold">项目配置</h2>
              <p className="mt-1 text-xs leading-5 text-[#7b808a]">上传产品素材并设置生成参数。</p>
            </header>
            <div className="p-5">
              <section aria-labelledby="product-images-title">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 id="product-images-title" className="text-sm font-semibold text-[#343840]">产品参考图</h3>
                  <span className="text-[11px] text-[#8b909a]">{state.files.length} / 6</span>
                </div>
                <ImageUploader files={state.files} disabled={inputsDisabled} onFilesChanged={(files) => {
                  if (generationBusyRef.current) return;
                  invalidateAnalysis();
                  dispatch({ type: "files_changed", files });
                }} />
              </section>

              <div className="my-5 h-px bg-[#eceef2]" />

              <section aria-labelledby="product-info-title">
                <h3 id="product-info-title" className="text-sm font-semibold text-[#343840]">产品信息</h3>
                <label className="mt-3 block text-xs font-medium text-[#5f646e]">
                  产品名称
                  <input className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]" placeholder="例如：手工玻璃杯" disabled={inputsDisabled} value={state.productName} onChange={(event) => {
                    if (generationBusyRef.current) return;
                    invalidateAnalysis();
                    dispatch({ type: "text_changed", productName: event.currentTarget.value });
                  }} />
                </label>
                <label className="mt-3 block text-xs font-medium text-[#5f646e]">
                  补充要求
                  <textarea className="mt-1.5 block min-h-20 w-full resize-y rounded-lg border border-[#d8dbe2] bg-white px-3 py-2 text-sm leading-6 text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]" placeholder="可填写卖点、场景或文案偏好" disabled={inputsDisabled} value={state.requirements} onChange={(event) => {
                    if (generationBusyRef.current) return;
                    invalidateAnalysis();
                    dispatch({ type: "text_changed", requirements: event.currentTarget.value });
                  }} />
                </label>
              </section>

              <div className="my-5 h-px bg-[#eceef2]" />

              <section aria-labelledby="generation-settings-title">
                <h3 id="generation-settings-title" className="mb-3 text-sm font-semibold text-[#343840]">生成设置</h3>
                <GenerationSettingsForm value={state.settings} disabled={inputsDisabled} onChange={(patch) => {
                  if (generationBusyRef.current) return;
                  invalidateAnalysis();
                  dispatch({ type: "settings_changed", patch });
                }} />
              </section>

              <button aria-label="开始分析产品" className="mt-5 w-full rounded-lg bg-[#17191d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={() => void handleAnalyze()} disabled={inputsDisabled}>
                {analysisBusy ? "正在分析产品…" : "开始分析产品"}
              </button>
              {state.notice && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-700" role="alert">{state.notice}</p>}
              {downloadNotice && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-700" role="alert">{downloadNotice}</p>}
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-[#e0e3e9] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]" aria-labelledby="creation-workspace-title" aria-live="polite">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e9ebef] px-5 py-4 md:px-6">
              <div>
                <h2 id="creation-workspace-title" className="text-base font-semibold">创作工作台</h2>
                <p className="mt-1 text-xs leading-5 text-[#7b808a]">修改内容会直接用于下一阶段，进入下一阶段前请检查当前结果。</p>
              </div>
              <span className="rounded-full bg-[#f1efff] px-3 py-1.5 text-xs font-medium text-[#6255b4]">{phaseLabels[state.phase]}</span>
            </header>
            <div className="min-h-[560px] p-4 md:p-6">
              {state.phase === "analyzing" ? (
                <div className="flex min-h-[500px] flex-col items-center justify-center text-center">
                  <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-[#eeebff] text-lg text-[#675ab8]">•••</span>
                  <h3 className="mt-4 font-semibold text-[#292c32]">AI 正在分析产品</h3>
                  <p className="mt-2 text-sm text-[#7b808a]">正在识别材质、卖点与适合的视觉方向…</p>
                </div>
              ) : state.phase === "reviewing_plan" && state.analysis ? (
                <>
                  <AnalysisPanel analysis={state.analysis} />
                  <PlanEditor analysis={state.analysis} disabled={inputsDisabled} onChange={(analysis) => dispatch({ type: "plan_changed", analysis })} onReplan={() => void handleAnalyze()} onConfirm={() => void handleGenerate()} />
                </>
              ) : state.analysis && state.tasks.length > 0 ? (
                <GenerationGrid
                  items={state.analysis.plan}
                  tasks={state.tasks}
                  busy={generationBusy}
                  retryingItemId={retryingItemId}
                  downloadBusy={downloadBusy}
                  onRetry={(item) => void handleRetry(item)}
                  onContinuePolling={(task) => void handleContinuePolling(task)}
                  onDownload={(task) => {
                    if (!task.downloadToken) return;
                    void runDownload(
                      () => downloadResult(task.downloadToken!, `product-${task.planItemId}.png`),
                      "图片下载失败，请重试",
                    );
                  }}
                  onDownloadAll={() => void runDownload(
                    () => downloadAllResults(state.tasks),
                    "结果打包下载失败，请重试",
                  )}
                />
              ) : state.analysis ? (
                <AnalysisPanel analysis={state.analysis} />
              ) : (
                <div className="flex min-h-[500px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9dce3] bg-[#fafbfc] px-6 text-center">
                  <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-white text-xl text-[#6d5ce7] shadow-sm ring-1 ring-black/5">✦</span>
                  <h3 className="mt-4 font-semibold text-[#292c32]">从上传产品图开始</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[#7b808a]">完成左侧项目配置并点击“开始分析产品”，商品洞察与出图规划会显示在这里。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
