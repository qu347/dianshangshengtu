"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  VideoIntroSettingsSchema,
  type ShotScript,
  type VideoIntroTask,
} from "../model";
import { defaultShotTasks, initialProductVideoState, productVideoReducer } from "../state";
import { analyzeIntroClient, fetchClipBlob, getShotStatusClient, submitShotClient, type ProductVideoApi } from "../lib/client";
import { runShotBatch } from "../lib/intro-runner";
import { downloadAllShots, downloadMergedVideo, downloadShot, succeededTokensInOrder } from "../lib/downloads";
import { preprocessProductImage, validateProductFiles } from "@/features/product-studio/lib/image-files";
import { IntroScriptEditor } from "./intro-script-editor";
import { ShotGrid } from "./shot-grid";

const steps = ["上传商品图", "AI 脚本分析", "确认脚本", "生成视频", "完成"];
const phaseSteps = { input: 0, analyzing: 1, reviewing_script: 2, generating: 3, completed: 4, partial_failed: 4, failed: 4, cancelled: 4 } as const;

const defaultProductVideoApi: ProductVideoApi = {
  analyze: analyzeIntroClient,
  submit: submitShotClient,
  status: getShotStatusClient,
};

export function ProductVideo({ api = defaultProductVideoApi }: { api?: ProductVideoApi }) {
  const [state, dispatch] = useReducer(productVideoReducer, initialProductVideoState);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const generatingRef = useRef(false);
  const generationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => generationAbortRef.current?.abort(), []);

  async function handleProductImages(selected: File[]) {
    if (generatingRef.current) return;
    if (selected.length === 0) {
      dispatch({ type: "images_changed", images: [] });
      return;
    }
    const errors = validateProductFiles(selected);
    if (errors.length) {
      dispatch({ type: "notice", message: errors[0] });
      return;
    }
    try {
      const processed = await Promise.all(selected.map(preprocessProductImage));
      dispatch({ type: "images_changed", images: processed });
    } catch (error) {
      dispatch({ type: "notice", message: error instanceof Error ? error.message : "图片处理失败" });
    }
  }

  async function handleAnalyze() {
    if (analyzing || generatingRef.current) return;
    if (state.productImages.length === 0) {
      dispatch({ type: "notice", message: "请先上传至少 1 张商品图" });
      return;
    }
    setAnalyzing(true);
    dispatch({ type: "analyze_started" });
    try {
      const script = await api.analyze({
        imageFiles: state.productImages,
        productName: state.productName,
        requirements: state.requirements,
        settings: state.settings,
      });
      dispatch({ type: "analyze_succeeded", script });
    } catch (error) {
      dispatch({ type: "analyze_failed", message: error instanceof Error ? error.message : "分析失败，请稍后重试" });
    } finally {
      setAnalyzing(false);
    }
  }

  async function runGeneration(shots: ShotScript[], retryShotId?: string) {
    if (analyzing || generatingRef.current) return;
    if (state.productImages.length === 0) {
      dispatch({ type: "notice", message: "请先上传至少 1 张商品图" });
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    const controller = new AbortController();
    generationAbortRef.current = controller;
    const startTasks = retryShotId
      ? state.tasks
      : defaultShotTasks({ styleNotes: state.script?.styleNotes ?? "", shots });
    let finalTasks = startTasks;
    if (retryShotId) {
      dispatch({ type: "shot_retry_started", shotId: retryShotId });
    } else {
      dispatch({ type: "generation_started", tasks: startTasks });
    }
    try {
      const batchTasks = await runShotBatch({
        shots,
        productImages: state.productImages,
        settings: state.settings,
        api: { submit: api.submit, status: api.status },
        onShotChange: (task) => {
          finalTasks = finalTasks.map((current) => current.shotId === task.shotId ? task : current);
          dispatch({ type: "shot_changed", task });
        },
        signal: controller.signal,
      });
      for (const task of batchTasks) {
        finalTasks = finalTasks.map((current) => current.shotId === task.shotId ? task : current);
      }
      if (!controller.signal.aborted) {
        dispatch({ type: "generation_completed", tasks: finalTasks });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        dispatch({ type: "notice", message: error instanceof Error ? error.message : "视频任务失败" });
      }
    } finally {
      if (controller.signal.aborted) {
        dispatch({ type: "generation_cancelled", tasks: finalTasks });
      }
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  async function handleRetry(task: VideoIntroTask) {
    const shot = state.script?.shots.find((item) => item.id === task.shotId);
    if (!shot) return;
    await runGeneration([shot], shot.id);
  }

  function cancelGeneration() {
    generationAbortRef.current?.abort();
  }

  function runDownload(operation: () => Promise<void>, fallbackMessage: string) {
    if (downloadBusy) return;
    setDownloadBusy(true);
    setDownloadNotice(null);
    operation()
      .catch((error) => setDownloadNotice(error instanceof Error ? error.message : fallbackMessage))
      .finally(() => setDownloadBusy(false));
  }

  const inputsDisabled = analyzing || generating;
  const activeStep = phaseSteps[state.phase];

  return (
    <section className="px-4 py-6 md:px-8 md:py-8" aria-labelledby="product-video-title">
      <div className="mx-auto max-w-[1320px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b808b]">PRODUCT INTRO VIDEO</p>
            <h1 id="product-video-title" className="mt-1 text-2xl font-bold tracking-tight text-[#17191d] md:text-[30px]">商品介绍视频</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#666b75]">上传商品图并填写卖点，一键生成黑金质感、大字卖点叠层的商品介绍短视频。商品图只在生成关键帧时提交给绘图服务。</p>
          </div>
        </header>

        <ol aria-label="任务进度" className="mt-5 grid gap-2 rounded-2xl border border-[#e3e6eb] bg-white p-2 shadow-[0_1px_2px_rgba(16,24,40,0.03)] sm:grid-cols-5">
          {steps.map((label, index) => (
            <li key={label} aria-current={index === activeStep ? "step" : undefined}
              className={index === activeStep ? "flex items-center gap-2 rounded-xl bg-[#eeebff] px-3 py-2.5 text-[#5f52aa]" : "flex items-center gap-2 rounded-xl px-3 py-2.5 text-[#767b85]"}>
              <span className={index === activeStep ? "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#6d5ce7] text-[11px] font-semibold text-white" : "flex size-6 shrink-0 items-center justify-center rounded-full bg-[#f0f1f3] text-[11px] font-semibold"}>{String(index + 1).padStart(2, "0")}</span>
              <span className="text-xs font-medium">{label}</span>
            </li>
          ))}
        </ol>

        <div className="mt-5 grid items-start gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="overflow-hidden rounded-2xl border border-[#e0e3e9] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]" aria-labelledby="intro-config-title">
            <header className="border-b border-[#e9ebef] px-5 py-4">
              <h2 id="intro-config-title" className="text-base font-semibold">商品信息</h2>
              <p className="mt-1 text-xs leading-5 text-[#7b808a]">JPG、PNG、WEBP，1~6 张，单张 ≤15MB。</p>
            </header>
            <div className="p-5">
              <section aria-labelledby="intro-product-images-title">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 id="intro-product-images-title" className="text-sm font-semibold text-[#343840]">商品图</h3>
                  <span className="text-[11px] text-[#8b909a]">{state.productImages.length} / 6</span>
                </div>
                <label className="flex min-h-20 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#cfd3dc] bg-[#fafbfc] px-4 py-4 text-center transition hover:border-[#9b91e8] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <input
                    className="sr-only"
                    aria-label="上传商品图"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp"
                    disabled={inputsDisabled}
                    onChange={(event) => void handleProductImages(Array.from(event.currentTarget.files ?? []))}
                  />
                  <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-[#17191d] text-lg leading-none text-white">＋</span>
                  <span className="mt-2 text-sm font-medium text-[#24272d]">选择商品图（1~6 张）</span>
                  <span className="mt-1 text-xs text-[#747984]">首图将作为视频首帧参考</span>
                </label>
                {state.productImages.length > 0 && (
                  <p className="mt-2 text-xs text-[#555a64]" role="status">已选择 {state.productImages.length} 张商品图。</p>
                )}
              </section>

              <div className="my-5 h-px bg-[#eceef2]" />

              <label className="block text-xs font-medium text-[#5f646e]">
                商品名称
                <input className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]" placeholder="例如：无线蓝牙耳机" disabled={inputsDisabled} value={state.productName} onChange={(event) => dispatch({ type: "text_changed", productName: event.currentTarget.value })} />
              </label>
              <label className="mt-3 block text-xs font-medium text-[#5f646e]">
                卖点要求
                <textarea className="mt-1.5 block min-h-20 w-full resize-y rounded-lg border border-[#d8dbe2] bg-white px-3 py-2 text-sm leading-6 text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]" placeholder="例如：突出 96 小时超长续航、自适应降噪" disabled={inputsDisabled} value={state.requirements} onChange={(event) => dispatch({ type: "text_changed", requirements: event.currentTarget.value })} />
              </label>

              <div className="mt-3 grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-[#5f646e]">
                  视频比例
                  <select aria-label="视频比例" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" disabled={inputsDisabled} value={state.settings.aspectRatio} onChange={(event) => dispatch({ type: "settings_changed", patch: VideoIntroSettingsSchema.parse({ ...state.settings, aspectRatio: event.currentTarget.value }) })}>
                    <option value="9:16">9:16 适用于抖音</option>
                    <option value="1:1">1:1 适用详情页</option>
                    <option value="16:9">16:9 适用横版展示</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-[#5f646e]">
                  文字语言
                  <select aria-label="文字语言" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" disabled={inputsDisabled} value={state.settings.language} onChange={(event) => dispatch({ type: "settings_changed", patch: VideoIntroSettingsSchema.parse({ ...state.settings, language: event.currentTarget.value }) })}>
                    <option value="zh-CN">中文</option>
                    <option value="en">英语</option>
                    <option value="ru">俄文</option>
                  </select>
                </label>
              </div>
              <label className="mt-3 block text-xs font-medium text-[#5f646e]">
                视频清晰度
                <select aria-label="视频清晰度" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" disabled={inputsDisabled} value={state.settings.resolution} onChange={(event) => dispatch({ type: "settings_changed", patch: VideoIntroSettingsSchema.parse({ ...state.settings, resolution: event.currentTarget.value }) })}>
                  <option value="480p">480p 标清（更省积分）</option>
                  <option value="720p">720p 高清</option>
                </select>
              </label>
              <label className="mt-3 block text-xs font-medium text-[#5f646e]">
                视频总时长（{state.settings.durationSec} 秒）
                <input aria-label="视频总时长" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" type="number" min={5} max={30} step={1} disabled={inputsDisabled} value={state.settings.durationSec} onChange={(event) => {
                  const durationSec = Number(event.currentTarget.value);
                  if (Number.isInteger(durationSec) && durationSec >= 5 && durationSec <= 30) {
                    dispatch({ type: "settings_changed", patch: VideoIntroSettingsSchema.parse({ ...state.settings, durationSec }) });
                  }
                }} />
              </label>

              <button aria-label="开始生成脚本" className="mt-5 w-full rounded-lg bg-[#17191d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={() => void handleAnalyze()} disabled={inputsDisabled || state.productImages.length === 0}>
                {analyzing ? "正在生成脚本…" : "开始生成脚本"}
              </button>
              {generating && (
                <button aria-label="取消生成" className="mt-3 w-full rounded-lg border border-[#d8dbe2] bg-white px-4 py-3 text-sm font-semibold text-[#343840] transition hover:bg-[#f6f7f9]" type="button" onClick={cancelGeneration}>
                  取消生成
                </button>
              )}
              {state.notice && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-700" role="alert">{state.notice}</p>}
              {downloadNotice && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm leading-5 text-red-700" role="alert">{downloadNotice}</p>}
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border border-[#e0e3e9] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]" aria-labelledby="intro-workspace-title">
            <header className="border-b border-[#e9ebef] px-5 py-4 md:px-6">
              <h2 id="intro-workspace-title" className="text-base font-semibold">创作工作台</h2>
            </header>
            <div className="min-h-[420px] p-4 md:p-6">
              {state.phase === "analyzing" ? (
                <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
                  <h3 className="font-semibold text-[#292c32]">AI 正在策划介绍视频脚本</h3>
                  <p className="mt-2 text-sm text-[#7b808a]">正在设计黑金质感画面、卖点文字与运镜节奏…</p>
                </div>
              ) : state.phase === "reviewing_script" && state.script ? (
                <IntroScriptEditor
                  script={state.script}
                  settings={state.settings}
                  disabled={inputsDisabled}
                  onChange={(script) => dispatch({ type: "script_changed", script })}
                  onReanalyze={() => void handleAnalyze()}
                  onConfirm={() => void runGeneration(state.script!.shots)}
                />
              ) : state.script && state.tasks.length > 0 ? (
                <ShotGrid
                  script={state.script}
                  tasks={state.tasks}
                  busy={generating}
                  downloadBusy={downloadBusy}
                  onRetry={(task) => void handleRetry(task)}
                  onDownload={(task) => {
                    if (!task.downloadToken) return;
                    runDownload(() => downloadShot(task.downloadToken!, task.shotId, fetchClipBlob), "视频下载失败，请重试");
                  }}
                  onDownloadAll={() => runDownload(() => downloadAllShots(state.tasks, state.script, fetchClipBlob), "打包下载失败，请重试")}
                  onDownloadMerged={() => runDownload(
                    () => downloadMergedVideo(succeededTokensInOrder(state.tasks, state.script!)),
                    "合并视频下载失败，请重试",
                  )}
                />
              ) : (
                <div className="flex min-h-[380px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9dce3] bg-[#fafbfc] px-6 text-center">
                  <h3 className="font-semibold text-[#292c32]">从上传商品图开始</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[#7b808a]">上传商品图并填写卖点要求，AI 会输出可编辑的介绍视频脚本，再生成黑金质感、大字卖点叠层的商品视频。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
