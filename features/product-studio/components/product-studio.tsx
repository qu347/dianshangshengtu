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
    <section className="p-4 md:p-6" aria-labelledby="studio-title">
      <h1 id="studio-title" className="text-2xl font-medium">一键生成主图与详情图组</h1>
      <ol aria-label="任务进度" className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        {steps.map((label, index) => (
          <li
            key={label}
            aria-current={index === activeStep ? "step" : undefined}
            className={index === activeStep ? "rounded-lg bg-violet-100 p-2 text-violet-700" : "rounded-lg bg-white p-2 text-black/55"}
          >
            {label}
          </li>
        ))}
      </ol>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="rounded-xl bg-white p-4">
          <ImageUploader files={state.files} disabled={inputsDisabled} onFilesChanged={(files) => {
            if (generationBusyRef.current) return;
            invalidateAnalysis();
            dispatch({ type: "files_changed", files });
          }} />
          <label className="mt-4 block">
            产品名称
            <input className="mt-1 block w-full rounded border border-black/15 p-2" disabled={inputsDisabled} value={state.productName} onChange={(event) => {
              if (generationBusyRef.current) return;
              invalidateAnalysis();
              dispatch({ type: "text_changed", productName: event.currentTarget.value });
            }} />
          </label>
          <label className="mt-4 block">
            补充要求
            <textarea className="mt-1 block w-full rounded border border-black/15 p-2" disabled={inputsDisabled} value={state.requirements} onChange={(event) => {
              if (generationBusyRef.current) return;
              invalidateAnalysis();
              dispatch({ type: "text_changed", requirements: event.currentTarget.value });
            }} />
          </label>
          <div className="mt-4">
            <GenerationSettingsForm value={state.settings} disabled={inputsDisabled} onChange={(patch) => {
              if (generationBusyRef.current) return;
              invalidateAnalysis();
              dispatch({ type: "settings_changed", patch });
            }} />
          </div>
          <button className="mt-4 rounded-lg bg-violet-700 px-4 py-2 text-white disabled:opacity-60" type="button" onClick={() => void handleAnalyze()} disabled={inputsDisabled}>
            开始分析产品
          </button>
          {state.notice && <p className="mt-3 text-sm text-red-700" role="alert">{state.notice}</p>}
          {downloadNotice && <p className="mt-3 text-sm text-red-700" role="alert">{downloadNotice}</p>}
        </div>
        <div className="rounded-xl bg-white p-4" aria-live="polite">
          {state.phase === "analyzing" ? <p>AI 正在分析产品…</p> : state.phase === "reviewing_plan" && state.analysis ? <><AnalysisPanel analysis={state.analysis} /><PlanEditor analysis={state.analysis} disabled={inputsDisabled} onChange={(analysis) => dispatch({ type: "plan_changed", analysis })} onReplan={() => void handleAnalyze()} onConfirm={() => void handleGenerate()} /></> : state.analysis && state.tasks.length > 0 ? <GenerationGrid items={state.analysis.plan} tasks={state.tasks} busy={generationBusy} retryingItemId={retryingItemId} downloadBusy={downloadBusy} onRetry={(item) => void handleRetry(item)} onContinuePolling={(task) => void handleContinuePolling(task)} onDownload={(task) => {
            if (!task.downloadToken) return;
            void runDownload(
              () => downloadResult(task.downloadToken!, `product-${task.planItemId}.png`),
              "图片下载失败，请重试",
            );
          }} onDownloadAll={() => void runDownload(
            () => downloadAllResults(state.tasks),
            "结果打包下载失败，请重试",
          )} /> : state.analysis ? <AnalysisPanel analysis={state.analysis} /> : <p>上传产品图并点击“开始分析产品”</p>}
        </div>
      </div>
    </section>
  );
}
