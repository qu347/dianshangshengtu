"use client";

import { useReducer } from "react";
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
  const activeStep = activeSteps[state.phase];

  async function handleAnalyze() {
    if (state.files.length === 0) {
      dispatch({ type: "analysis_failed", message: "请至少上传 1 张产品图" });
      return;
    }

    dispatch({ type: "analysis_started" });
    try {
      const analysis = await api.analyze({
        files: state.files,
        settings: state.settings,
        productName: state.productName,
        requirements: state.requirements,
      });
      dispatch({ type: "analysis_succeeded", analysis });
    } catch (error) {
      dispatch({ type: "analysis_failed", message: error instanceof Error ? error.message : "分析失败，请稍后重试" });
    }
  }

  async function handleGenerate() {
    if (!state.analysis) return;
    dispatch({
      type: "generation_started",
      tasks: state.analysis.plan.map((item) => ({ planItemId: item.id, status: "queued", progress: 0 })),
    });
    await runGenerationBatch({
      items: state.analysis.plan,
      files: state.files,
      settings: state.settings,
      api,
      onTaskChange: (task) => dispatch({ type: "task_changed", task }),
    });
    dispatch({ type: "generation_completed" });
  }

  async function handleRetry(item: PlanItem) {
    await runGenerationBatch({
      items: [item],
      files: state.files,
      settings: state.settings,
      api,
      onTaskChange: (task) => dispatch({ type: "task_changed", task }),
    });
    dispatch({ type: "generation_completed" });
  }

  async function handleContinuePolling(task: GenerationTask) {
    if (!task.providerJobId) return;
    await pollGenerationJob({
      providerJobId: task.providerJobId,
      planItemId: task.planItemId,
      api,
      onTaskChange: (next) => dispatch({ type: "task_changed", task: next }),
    });
    dispatch({ type: "generation_completed" });
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
          <ImageUploader files={state.files} onFilesChanged={(files) => dispatch({ type: "files_changed", files })} />
          <label className="mt-4 block">
            产品名称
            <input className="mt-1 block w-full rounded border border-black/15 p-2" value={state.productName} onChange={(event) => dispatch({ type: "text_changed", productName: event.currentTarget.value })} />
          </label>
          <label className="mt-4 block">
            补充要求
            <textarea className="mt-1 block w-full rounded border border-black/15 p-2" value={state.requirements} onChange={(event) => dispatch({ type: "text_changed", requirements: event.currentTarget.value })} />
          </label>
          <div className="mt-4">
            <GenerationSettingsForm value={state.settings} onChange={(patch) => dispatch({ type: "settings_changed", patch })} />
          </div>
          <button className="mt-4 rounded-lg bg-violet-700 px-4 py-2 text-white disabled:opacity-60" type="button" onClick={() => void handleAnalyze()} disabled={state.phase === "analyzing"}>
            开始分析产品
          </button>
          {state.notice && <p className="mt-3 text-sm text-red-700" role="alert">{state.notice}</p>}
        </div>
        <div className="rounded-xl bg-white p-4" aria-live="polite">
          {state.phase === "analyzing" ? <p>AI 正在分析产品…</p> : state.phase === "reviewing_plan" && state.analysis ? <><AnalysisPanel analysis={state.analysis} /><PlanEditor analysis={state.analysis} onChange={(analysis) => dispatch({ type: "plan_changed", analysis })} onReplan={() => void handleAnalyze()} onConfirm={() => void handleGenerate()} /></> : state.analysis && state.tasks.length > 0 ? <GenerationGrid items={state.analysis.plan} tasks={state.tasks} onRetry={(item) => void handleRetry(item)} onContinuePolling={(task) => void handleContinuePolling(task)} onDownload={(task) => task.downloadToken && void downloadResult(task.downloadToken, `product-${task.planItemId}.png`)} onDownloadAll={() => void downloadAllResults(state.tasks)} /> : state.analysis ? <AnalysisPanel analysis={state.analysis} /> : <p>上传产品图并点击“开始分析产品”</p>}
        </div>
      </div>
    </section>
  );
}
