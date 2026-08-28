"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  analyzeClothingClient,
  getClothingGenerationStatusClient,
  submitClothingCandidatesClient,
  submitClothingGenerationClient,
  type ClothingStudioApi,
} from "../lib/client-api";
import { downloadAllClothingResults, downloadClothingResult } from "../lib/downloads";
import { pollClothingJob, runClothingGenerationBatch } from "../lib/generation-runner";
import { loadClothingSession, saveClothingSession } from "../lib/session-store";
import type { ClothingGenerationTask, ClothingPlanItem, ReferenceAsset } from "../model";
import { clothingStudioReducer, initialClothingStudioState } from "../state";
import { ClothingAnalysisPanel } from "./clothing-analysis-panel";
import { ClothingPlanEditor } from "./clothing-plan-editor";
import { ClothingResultGrid } from "./clothing-result-grid";
import { ClothingSettingsForm } from "./clothing-settings";
import { GarmentUploader } from "./garment-uploader";
import { ReferenceCard } from "./reference-card";
import { ReferencePickerDialog } from "./reference-picker-dialog";

const defaultApi: ClothingStudioApi = {
  analyze: analyzeClothingClient,
  submitCandidates: submitClothingCandidatesClient,
  submit: submitClothingGenerationClient,
  status: getClothingGenerationStatusClient,
};

const phaseLabels = {
  input: "准备素材",
  analyzing: "AI 分析中",
  reviewing_plan: "确认规划",
  generating_main: "生成白底主图",
  generating_set: "批量生成中",
  completed: "任务完成",
} as const;

export function ClothingStudio({ api = defaultApi }: { api?: ClothingStudioApi }) {
  const [state, dispatch] = useReducer(clothingStudioReducer, initialClothingStudioState);
  const [dialog, setDialog] = useState<"model" | "scene" | null>(null);
  const [analysisBusy, setAnalysisBusy] = useState(false);
  const [generationBusy, setGenerationBusy] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const analysisEpoch = useRef(0);
  const generationEpoch = useRef(0);
  const restored = useRef(false);
  const inputsDisabled = analysisBusy || generationBusy;

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const session = loadClothingSession();
    if (!session) return;
    dispatch({ type: "session_restored", session });
    session.tasks.forEach((task) => {
      if (!task.providerJobId || (task.status !== "running" && task.status !== "timed_out")) return;
      void pollClothingJob({
        providerJobId: task.providerJobId,
        planItemId: task.planItemId,
        api,
        onTaskChange: (next) => dispatch({ type: "task_changed", task: next }),
      });
    });
  }, [api]);

  useEffect(() => {
    if (state.analysis && state.tasks.length > 0) {
      saveClothingSession({ settings: state.settings, analysis: state.analysis, tasks: state.tasks });
    }
  }, [state.analysis, state.settings, state.tasks]);

  function invalidateRunningWork() {
    analysisEpoch.current += 1;
    generationEpoch.current += 1;
  }

  async function handleAnalyze() {
    if (inputsDisabled) return;
    if (!state.selectedModel) {
      dispatch({ type: "analysis_failed", message: "请选择模特图" });
      return;
    }
    if (state.garments.length === 0) {
      dispatch({ type: "analysis_failed", message: "请至少上传 1 张服装图" });
      return;
    }
    const epoch = ++analysisEpoch.current;
    setAnalysisBusy(true);
    dispatch({ type: "analysis_started" });
    try {
      const analysis = await api.analyze({
        garments: state.garments,
        settings: state.settings,
        requirements: state.requirements,
        model: state.selectedModel,
        scene: state.selectedScene,
      });
      if (epoch === analysisEpoch.current) dispatch({ type: "analysis_succeeded", analysis });
    } catch (cause) {
      if (epoch === analysisEpoch.current) {
        dispatch({
          type: "analysis_failed",
          message: cause instanceof Error ? cause.message : "服装分析失败，请稍后重试",
        });
      }
    } finally {
      setAnalysisBusy(false);
    }
  }

  async function runGeneration(items: ClothingPlanItem[], baseImageToken?: string) {
    if (!state.selectedModel || state.garments.length === 0 || generationBusy) return;
    const epoch = ++generationEpoch.current;
    setGenerationBusy(true);
    try {
      await runClothingGenerationBatch({
        items,
        garments: state.garments,
        settings: state.settings,
        model: state.selectedModel,
        scene: state.selectedScene,
        baseImageToken,
        api,
        onTaskChange: (task) => {
          if (epoch !== generationEpoch.current) return;
          if (task.planItemId !== "1") dispatch({ type: "generation_set_started" });
          dispatch({ type: "task_changed", task });
        },
      });
      if (epoch === generationEpoch.current) dispatch({ type: "generation_completed" });
    } finally {
      setGenerationBusy(false);
    }
  }

  async function handleGenerate() {
    if (!state.analysis) return;
    dispatch({
      type: "generation_started",
      tasks: state.analysis.plan.map((item) => ({ planItemId: item.id, status: "queued", progress: 0 })),
    });
    await runGeneration(state.analysis.plan);
  }

  async function handleRetry(item: ClothingPlanItem) {
    if (!state.analysis || state.recovered) return;
    if (item.id === "1") {
      const blockedIds = new Set(state.tasks.filter((task) => (
        task.error === "请先生成或重试白底立体服装主图"
      )).map((task) => task.planItemId));
      await runGeneration([
        item,
        ...state.analysis.plan.filter((candidate) => blockedIds.has(candidate.id)),
      ]);
      return;
    }
    const mainToken = state.tasks.find((task) => (
      task.planItemId === "1" && task.status === "succeeded" && task.downloadToken
    ))?.downloadToken;
    if (!mainToken) return;
    await runGeneration([item], mainToken);
  }

  async function continuePolling(task: ClothingGenerationTask) {
    if (!task.providerJobId || generationBusy) return;
    setGenerationBusy(true);
    try {
      await pollClothingJob({
        providerJobId: task.providerJobId,
        planItemId: task.planItemId,
        api,
        onTaskChange: (next) => dispatch({ type: "task_changed", task: next }),
      });
    } finally {
      setGenerationBusy(false);
    }
  }

  function selectReference(asset: ReferenceAsset) {
    invalidateRunningWork();
    dispatch(asset.kind === "model"
      ? { type: "model_changed", model: asset }
      : { type: "scene_changed", scene: asset });
    setDialog(null);
  }

  const candidateApi = { submitCandidates: api.submitCandidates, status: api.status };
  return (
    <section className="px-4 py-6 md:px-8 md:py-8" aria-labelledby="clothing-studio-title">
      <div className="mx-auto max-w-[1440px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#838892]">FASHION VISUAL WORKFLOW</p>
            <h1 id="clothing-studio-title" className="mt-1 text-2xl font-bold md:text-[30px]">服装组图工作台</h1>
            <p className="mt-1.5 text-sm leading-6 text-[#686d77]">选择服装、固定模特与可选场景，生成风格一致的完整电商组图。</p>
          </div>
          <span className="rounded-full bg-[#ebe8ff] px-3 py-2 text-xs font-medium text-[#5d51a8]">{phaseLabels[state.phase]}</span>
        </header>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-3xl border border-[#e0e2e7] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]">
            <header className="border-b border-[#eceef1] px-5 py-4"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#858a94]">PROJECT INPUTS</p><h2 className="mt-1 font-semibold">素材与生成设置</h2></header>
            <div className="space-y-5 p-5">
              <section>
                <div className="mb-2 flex justify-between"><h3 className="text-sm font-semibold">服装参考图</h3><span className="text-xs text-[#888d97]">{state.garments.length} / 6</span></div>
                <GarmentUploader files={state.garments} disabled={inputsDisabled} onFilesChanged={(garments) => { invalidateRunningWork(); dispatch({ type: "garments_changed", garments }); }} />
              </section>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <ReferenceCard kind="model" value={state.selectedModel} disabled={inputsDisabled} onUpload={() => setDialog("model")} onGenerate={() => setDialog("model")} onReselect={() => setDialog("model")} onDelete={() => { invalidateRunningWork(); dispatch({ type: "model_changed", model: null }); }} />
                <ReferenceCard kind="scene" value={state.selectedScene} disabled={inputsDisabled} onUpload={() => setDialog("scene")} onGenerate={() => setDialog("scene")} onReselect={() => setDialog("scene")} onDelete={() => { invalidateRunningWork(); dispatch({ type: "scene_changed", scene: null }); }} />
              </div>
              <label className="block text-xs font-medium text-[#626772]">补充要求<textarea aria-label="补充要求" maxLength={1000} disabled={inputsDisabled} value={state.requirements} onChange={(event) => { invalidateRunningWork(); dispatch({ type: "requirements_changed", requirements: event.currentTarget.value }); }} className="mt-1.5 min-h-20 w-full rounded-xl border border-[#d9dce3] p-3 text-sm" placeholder="可填写穿搭、镜头、场景或文案偏好" /></label>
              <div className="h-px bg-[#eceef1]" />
              <section><h3 className="mb-3 text-sm font-semibold">生成设置</h3><ClothingSettingsForm value={state.settings} disabled={inputsDisabled} onChange={(patch) => { invalidateRunningWork(); dispatch({ type: "settings_changed", patch }); }} /></section>
              <button type="button" aria-label="开始分析服装" disabled={inputsDisabled} onClick={() => void handleAnalyze()} className="w-full rounded-xl bg-[#17191d] px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{analysisBusy ? "正在分析服装…" : "开始分析服装"}</button>
              {state.notice && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">{state.notice}</p>}
              {downloadNotice && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm leading-5 text-red-700">{downloadNotice}</p>}
            </div>
          </aside>

          <main className="min-w-0 overflow-hidden rounded-3xl border border-[#e0e2e7] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]">
            <header className="border-b border-[#eceef1] px-5 py-4"><h2 className="font-semibold">创作工作台</h2><p className="mt-1 text-xs text-[#7a7f89]">先确认 AI 规划，再启动白底主图与整组生成。</p></header>
            <div className="min-h-[620px] p-4 md:p-6">
              {state.phase === "analyzing" ? (
                <div className="flex min-h-[540px] flex-col items-center justify-center text-center"><span className="text-2xl text-[#6d5ce7]">•••</span><h3 className="mt-4 font-semibold">AI 正在分析服装</h3><p className="mt-2 text-sm text-[#7a7f89]">正在识别版型、细节和适合的穿搭方向…</p></div>
              ) : state.phase === "reviewing_plan" && state.analysis ? <>
                <ClothingAnalysisPanel analysis={state.analysis} />
                <ClothingPlanEditor analysis={state.analysis} settings={state.settings} disabled={inputsDisabled} onChange={(analysis) => dispatch({ type: "plan_changed", analysis })} onReplan={() => void handleAnalyze()} onConfirm={() => void handleGenerate()} />
              </> : state.analysis && state.tasks.length > 0 ? (
                <ClothingResultGrid
                  items={state.analysis.plan}
                  tasks={state.tasks}
                  recovered={state.recovered}
                  busy={generationBusy}
                  onRetry={(item) => void handleRetry(item)}
                  onContinuePolling={(task) => void continuePolling(task)}
                  onDownload={(task) => {
                    if (!task.downloadToken) return;
                    setDownloadNotice(null);
                    void downloadClothingResult(task.downloadToken, `clothing-${String(Number(task.planItemId)).padStart(2, "0")}.png`).catch((cause) => setDownloadNotice(cause instanceof Error ? cause.message : "图片下载失败"));
                  }}
                  onDownloadAll={() => {
                    setDownloadNotice(null);
                    void downloadAllClothingResults(state.tasks).catch((cause) => setDownloadNotice(cause instanceof Error ? cause.message : "结果打包失败"));
                  }}
                />
              ) : (
                <div className="flex min-h-[540px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#d9dce3] bg-[#fafbfc] px-6 text-center"><span className="flex size-12 items-center justify-center rounded-2xl bg-white text-xl text-[#6d5ce7] shadow-sm">✦</span><h3 className="mt-4 font-semibold">从服装和模特开始</h3><p className="mt-2 max-w-md text-sm leading-6 text-[#7a7f89]">上传 1–6 张服装图并选择固定模特。场景图可选，AI 会先生成纯白立体服装主图，再完成整组视觉。</p></div>
              )}
            </div>
          </main>
        </div>
      </div>
      <ReferencePickerDialog kind="model" open={dialog === "model"} candidates={state.selectedModel ? [state.selectedModel] : []} onClose={() => setDialog(null)} onUse={selectReference} api={candidateApi} />
      <ReferencePickerDialog kind="scene" open={dialog === "scene"} candidates={state.selectedScene ? [state.selectedScene] : []} onClose={() => setDialog(null)} onUse={selectReference} api={candidateApi} />
    </section>
  );
}
