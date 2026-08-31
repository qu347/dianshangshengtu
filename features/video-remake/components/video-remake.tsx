"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import {
  VideoRemakeSettingsSchema,
  type SceneScript,
  type VideoSceneTask,
} from "../model";
import { defaultSceneTasks, videoRemakeReducer, initialVideoRemakeState } from "../state";
import { analyzeScriptClient, getSceneStatusClient, submitSceneClient, fetchClipBlob } from "../lib/client";
import { runSceneBatch } from "../lib/scene-runner";
import { downloadAllScenes, downloadClip } from "../lib/downloads";
import { extractVideoFrames, validateReferenceVideo } from "../lib/frames";
import { preprocessProductImage, validateProductFiles } from "@/features/product-studio/lib/image-files";
import {
  getClothingGenerationStatusClient,
  submitClothingCandidatesClient,
} from "@/features/clothing-studio/lib/client-api";
import type { ReferenceAsset } from "@/features/clothing-studio/model";
import { ReferenceCard } from "@/features/clothing-studio/components/reference-card";
import { ReferencePickerDialog } from "@/features/clothing-studio/components/reference-picker-dialog";
import { ScriptEditor } from "./script-editor";
import { SceneGrid } from "./scene-grid";

const steps = ["上传参考视频", "AI 分镜分析", "确认脚本", "生成视频", "完成"];
const phaseSteps = { input: 0, analyzing: 1, reviewing_script: 2, generating: 3, completed: 4, partial_failed: 4, failed: 4, cancelled: 4 } as const;

export function VideoRemake() {
  const [state, dispatch] = useReducer(videoRemakeReducer, initialVideoRemakeState);
  const [analyzing, setAnalyzing] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const generatingRef = useRef(false);
  const generationAbortRef = useRef<AbortController | null>(null);
  const modelInputRef = useRef<HTMLInputElement | null>(null);
  const ownedModelUrlsRef = useRef(new Set<string>());

  useEffect(() => () => generationAbortRef.current?.abort(), []);
  useEffect(() => {
    const model = state.modelImage;
    const ownedUrls = ownedModelUrlsRef.current;
    if (model?.source !== "upload" || !ownedUrls.has(model.previewUrl)) return;
    return () => {
      ownedUrls.delete(model.previewUrl);
      URL.revokeObjectURL(model.previewUrl);
    };
  }, [state.modelImage]);

  async function handleVideoSelected(file: File | null) {
    if (generatingRef.current) return;
    if (!file) {
      dispatch({ type: "video_changed", video: null, frames: [], videoDurationSec: 0 });
      return;
    }
    const invalid = validateReferenceVideo(file);
    if (invalid) {
      dispatch({ type: "notice", message: invalid });
      return;
    }
    setExtracting(true);
    try {
      const frames = await extractVideoFrames(file, 6);
      dispatch({ type: "video_changed", video: file, frames, videoDurationSec: frames.durationSec });
    } catch (error) {
      dispatch({ type: "notice", message: error instanceof Error ? error.message : "视频处理失败" });
    } finally {
      setExtracting(false);
    }
  }

  async function handleAnalyze() {
    if (analyzing || generatingRef.current) return;
    if (!state.referenceVideo || state.frames.length === 0) {
      dispatch({ type: "notice", message: "请先上传参考视频" });
      return;
    }
    setAnalyzing(true);
    dispatch({ type: "analyze_started" });
    try {
      const script = await analyzeScriptClient({
        frameFiles: state.frames.map((frame) => frame.file),
        videoDurationSec: state.videoDurationSec,
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

  async function handleProductImages(selected: File[]) {
    if (generatingRef.current) return;
    const errors = validateProductFiles(selected);
    if (errors.length) {
      dispatch({ type: "notice", message: errors[0] });
      return;
    }
    try {
      const processed = await Promise.all(selected.map(preprocessProductImage));
      dispatch({ type: "product_images_changed", images: processed });
    } catch (error) {
      dispatch({ type: "notice", message: error instanceof Error ? error.message : "图片处理失败" });
    }
  }

  async function handleModelImage(selected: File | null) {
    if (generatingRef.current) return;
    if (modelInputRef.current) modelInputRef.current.value = "";
    if (!selected) {
      dispatch({ type: "model_image_changed", image: null });
      return;
    }
    const errors = validateProductFiles([selected]);
    if (errors.length) {
      dispatch({ type: "notice", message: errors[0] });
      return;
    }
    try {
      const file = await preprocessProductImage(selected);
      const previewUrl = URL.createObjectURL(file);
      ownedModelUrlsRef.current.add(previewUrl);
      const model: ReferenceAsset = {
        id: `video-model-upload-${crypto.randomUUID()}`,
        kind: "model",
        source: "upload",
        previewUrl,
        file,
      };
      dispatch({ type: "model_image_changed", image: model });
    } catch (error) {
      dispatch({ type: "notice", message: error instanceof Error ? error.message : "图片处理失败" });
    }
  }

  async function runGeneration(scenes: SceneScript[], retrySceneId?: string) {
    if (analyzing || generatingRef.current) return;
    if (state.productImages.length === 0) {
      dispatch({ type: "notice", message: "请先上传至少 1 张商品图" });
      return;
    }
    generatingRef.current = true;
    setGenerating(true);
    const controller = new AbortController();
    generationAbortRef.current = controller;
    const startTasks = retrySceneId
      ? state.tasks
      : defaultSceneTasks({ styleNotes: state.script?.styleNotes ?? "", scenes });
    let finalTasks = startTasks;
    if (retrySceneId) {
      dispatch({ type: "scene_retry_started", sceneId: retrySceneId });
    } else {
      dispatch({ type: "generation_started", tasks: startTasks });
    }
    try {
      const batchTasks = await runSceneBatch({
        scenes,
        productImages: state.productImages,
        modelImage: state.modelImage,
        settings: state.settings,
        api: { submit: submitSceneClient, status: getSceneStatusClient },
        onSceneChange: (task) => {
          finalTasks = finalTasks.map((current) => current.sceneId === task.sceneId ? task : current);
          dispatch({ type: "scene_changed", task });
        },
        signal: controller.signal,
      });
      for (const task of batchTasks) {
        finalTasks = finalTasks.map((current) => current.sceneId === task.sceneId ? task : current);
      }
      dispatch(controller.signal.aborted
        ? { type: "generation_cancelled", tasks: finalTasks }
        : { type: "generation_completed", tasks: finalTasks });
    } finally {
      if (generationAbortRef.current === controller) generationAbortRef.current = null;
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  async function handleRetry(task: VideoSceneTask) {
    const scene = state.script?.scenes.find((item) => item.id === task.sceneId);
    if (!scene) return;
    await runGeneration([scene], scene.id);
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
    <section className="px-4 py-6 md:px-8 md:py-8" aria-labelledby="video-remake-title">
      <div className="mx-auto max-w-[1320px]">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7b808b]">HIT VIDEO REMAKE</p>
            <h1 id="video-remake-title" className="mt-1 text-2xl font-bold tracking-tight text-[#17191d] md:text-[30px]">爆款视频复刻</h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#666b75]">上传原视频，添加商品与模特信息，即可复刻爆款视频。参考视频只在浏览器本地抽帧，不会上传原文件。</p>
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
          <aside className="overflow-hidden rounded-2xl border border-[#e0e3e9] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]" aria-labelledby="video-config-title">
            <header className="border-b border-[#e9ebef] px-5 py-4">
              <h2 id="video-config-title" className="text-base font-semibold">参考视频</h2>
              <p className="mt-1 text-xs leading-5 text-[#7b808a]">MP4 / WebM，≤150MB、≤90 秒。</p>
            </header>
            <div className="p-5">
              <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-[#cfd3dc] bg-[#fafbfc] px-4 py-5 text-center transition hover:border-[#9b91e8] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                <input
                  className="sr-only"
                  aria-label="上传参考视频"
                  type="file"
                  accept="video/mp4,video/webm"
                  disabled={inputsDisabled}
                  onChange={(event) => void handleVideoSelected(event.currentTarget.files?.[0] ?? null)}
                />
                <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-[#17191d] text-lg leading-none text-white">＋</span>
                <span className="mt-2 text-sm font-medium text-[#24272d]">{extracting ? "正在抽取画面帧…" : "选择或拖入参考视频"}</span>
                <span className="mt-1 text-xs text-[#747984]">{state.referenceVideo ? state.referenceVideo.name : "建议上传英语视频"}</span>
              </label>
              {state.frames.length > 0 && (
                <p className="mt-2 text-xs text-[#555a64]" role="status">已抽取 {state.frames.length} 帧画面用于分析。</p>
              )}

              <div className="my-5 h-px bg-[#eceef2]" />

              <section aria-labelledby="video-product-images-title">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 id="video-product-images-title" className="text-sm font-semibold text-[#343840]">商品图</h3>
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
                  <span className="text-sm font-medium text-[#24272d]">选择商品图（1~6 张）</span>
                  <span className="mt-1 text-xs text-[#747984]">JPG、PNG、WEBP</span>
                </label>
                {state.productImages.length > 0 && (
                  <p className="mt-2 text-xs text-[#555a64]" role="status">已选择 {state.productImages.length} 张商品图。</p>
                )}
              </section>

              <div className="mt-4">
                <input
                  ref={modelInputRef}
                  className="sr-only"
                  aria-label="选择本地模特图文件"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={inputsDisabled}
                  onChange={(event) => void handleModelImage(event.currentTarget.files?.[0] ?? null)}
                />
                <ReferenceCard
                  kind="model"
                  value={state.modelImage}
                  description="可选 · 所有分镜保持同一模特"
                  disabled={inputsDisabled}
                  onUpload={() => modelInputRef.current?.click()}
                  onGenerate={() => setModelDialogOpen(true)}
                  onReselect={() => setModelDialogOpen(true)}
                  onDelete={() => dispatch({ type: "model_image_changed", image: null })}
                />
              </div>

              <div className="my-5 h-px bg-[#eceef2]" />

              <label className="block text-xs font-medium text-[#5f646e]">
                商品信息
                <input className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]" placeholder="例如：无线蓝牙耳机" disabled={inputsDisabled} value={state.productName} onChange={(event) => dispatch({ type: "text_changed", productName: event.currentTarget.value })} />
              </label>
              <label className="mt-3 block text-xs font-medium text-[#5f646e]">
                补充要求
                <textarea className="mt-1.5 block min-h-20 w-full resize-y rounded-lg border border-[#d8dbe2] bg-white px-3 py-2 text-sm leading-6 text-[#24272d] focus:border-[#8175e5] disabled:bg-[#f3f4f6]" placeholder="可填写卖点、场景或文案偏好" disabled={inputsDisabled} value={state.requirements} onChange={(event) => dispatch({ type: "text_changed", requirements: event.currentTarget.value })} />
              </label>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="block text-xs font-medium text-[#5f646e]">
                  视频比例
                  <select aria-label="视频比例" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" disabled={inputsDisabled} value={state.settings.aspectRatio} onChange={(event) => dispatch({ type: "settings_changed", patch: VideoRemakeSettingsSchema.parse({ ...state.settings, aspectRatio: event.currentTarget.value }) })}>
                    <option value="9:16">9:16 适用于 TikTok</option>
                    <option value="1:1">1:1 适用详情页</option>
                    <option value="16:9">16:9 适用亚马逊</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-[#5f646e]">
                  视频语言
                  <select aria-label="视频语言" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" disabled={inputsDisabled} value={state.settings.language} onChange={(event) => dispatch({ type: "settings_changed", patch: VideoRemakeSettingsSchema.parse({ ...state.settings, language: event.currentTarget.value }) })}>
                    <option value="zh-CN">中文</option>
                    <option value="en">英语</option>
                    <option value="ru">俄文</option>
                  </select>
                </label>
                <label className="block text-xs font-medium text-[#5f646e]">
                  画质
                  <select aria-label="画质" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" disabled={inputsDisabled} value={state.settings.quality} onChange={(event) => dispatch({ type: "settings_changed", patch: VideoRemakeSettingsSchema.parse({ ...state.settings, quality: event.currentTarget.value }) })}>
                    <option value="480p">480P 流畅省积分</option>
                    <option value="720p">720P 高清</option>
                  </select>
                </label>
              </div>
              <label className="mt-3 block text-xs font-medium text-[#5f646e]">
                视频总时长（{state.settings.durationSec} 秒）
                <input aria-label="视频总时长" className="mt-1.5 block h-10 w-full rounded-lg border border-[#d8dbe2] bg-white px-3 text-sm disabled:bg-[#f3f4f6]" type="number" min={5} max={30} step={1} disabled={inputsDisabled} value={state.settings.durationSec} onChange={(event) => {
                  const durationSec = Number(event.currentTarget.value);
                  if (Number.isInteger(durationSec) && durationSec >= 5 && durationSec <= 30) {
                    dispatch({ type: "settings_changed", patch: VideoRemakeSettingsSchema.parse({ ...state.settings, durationSec }) });
                  }
                }} />
              </label>

              <button aria-label="开始分析视频" className="mt-5 w-full rounded-lg bg-[#17191d] px-4 py-3 text-sm font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={() => void handleAnalyze()} disabled={inputsDisabled || extracting || !state.referenceVideo}>
                {analyzing ? "正在分析视频…" : "开始分析视频"}
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

          <section className="min-w-0 overflow-hidden rounded-2xl border border-[#e0e3e9] bg-white shadow-[0_8px_28px_rgba(16,24,40,0.05)]" aria-labelledby="video-workspace-title">
            <header className="border-b border-[#e9ebef] px-5 py-4 md:px-6">
              <h2 id="video-workspace-title" className="text-base font-semibold">创作工作台</h2>
            </header>
            <div className="min-h-[420px] p-4 md:p-6">
              {state.phase === "analyzing" ? (
                <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
                  <h3 className="font-semibold text-[#292c32]">AI 正在分析参考视频</h3>
                  <p className="mt-2 text-sm text-[#7b808a]">正在识别镜头节奏、场景与文字风格…</p>
                </div>
              ) : state.phase === "reviewing_script" && state.script ? (
                <ScriptEditor
                  script={state.script}
                  settings={state.settings}
                  disabled={inputsDisabled}
                  onChange={(script) => dispatch({ type: "script_changed", script })}
                  onReanalyze={() => void handleAnalyze()}
                  onConfirm={() => void runGeneration(state.script!.scenes)}
                />
              ) : state.script && state.tasks.length > 0 ? (
                <SceneGrid
                  script={state.script}
                  tasks={state.tasks}
                  busy={generating}
                  downloadBusy={downloadBusy}
                  onRetry={(task) => void handleRetry(task)}
                  onDownload={(task) => {
                    if (!task.downloadToken) return;
                    runDownload(() => downloadClip(task.downloadToken!, task.sceneId, fetchClipBlob), "视频下载失败，请重试");
                  }}
                  onDownloadAll={() => runDownload(() => downloadAllScenes(state.tasks, state.script, fetchClipBlob), "打包下载失败，请重试")}
                />
              ) : (
                <div className="flex min-h-[380px] flex-col items-center justify-center rounded-xl border border-dashed border-[#d9dce3] bg-[#fafbfc] px-6 text-center">
                  <h3 className="font-semibold text-[#292c32]">从上传参考视频开始</h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-[#7b808a]">上传爆款视频并填写商品信息，AI 会输出可编辑的分镜脚本，再逐分镜生成你的商品视频。</p>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
      <ReferencePickerDialog
        kind="model"
        open={modelDialogOpen}
        candidates={state.modelImage ? [state.modelImage] : []}
        onClose={() => setModelDialogOpen(false)}
        onUse={(asset) => {
          dispatch({ type: "model_image_changed", image: asset });
          setModelDialogOpen(false);
        }}
        api={{
          submitCandidates: submitClothingCandidatesClient,
          status: getClothingGenerationStatusClient,
        }}
      />
    </section>
  );
}
