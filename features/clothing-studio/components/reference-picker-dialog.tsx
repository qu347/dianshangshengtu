"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ClothingGenerationTask,
  ModelCandidateRequest,
  ReferenceAsset,
  SceneCandidateRequest,
} from "../model";
import type { ClothingStudioApi } from "../lib/client-api";
import { runCandidateBatch } from "../lib/generation-runner";
import { preprocessClothingImage } from "../lib/image-files";
import { CLOTHING_RATIO_OPTIONS } from "./clothing-settings";

type Props = {
  kind: "model" | "scene";
  open: boolean;
  candidates: ReferenceAsset[];
  onClose: () => void;
  onUse: (asset: ReferenceAsset) => void;
  api: Pick<ClothingStudioApi, "submitCandidates" | "status">;
};

const selectClass = "mt-1.5 h-10 w-full rounded-xl border border-[#d9dce3] bg-white px-3 text-sm";
const labelClass = "block text-xs font-medium text-[#666b75]";
const initialModelRequest: ModelCandidateRequest = {
  gender: "female",
  ageRange: "26-35",
  appearance: "asian",
  bodyType: "regular",
  hairstyle: "medium",
  requirements: "",
  count: 1,
  quality: "auto",
};
const initialSceneRequest: SceneCandidateRequest = {
  style: "mobile",
  venue: "street",
  lighting: "natural",
  season: "all",
  requirements: "",
  count: 1,
  aspectRatio: "1090x1443",
  quality: "auto",
};

export function ReferencePickerDialog({ kind, open, candidates, onClose, onUse, api }: Props) {
  const [tab, setTab] = useState<"upload" | "generate">("generate");
  const [history, setHistory] = useState<ReferenceAsset[]>(candidates);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modelRequest, setModelRequest] = useState<ModelCandidateRequest>(initialModelRequest);
  const [sceneRequest, setSceneRequest] = useState<SceneCandidateRequest>(initialSceneRequest);
  const [tasks, setTasks] = useState<ClothingGenerationTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const objectUrls = useRef<string[]>([]);
  const name = kind === "model" ? "模特" : "场景";

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose, open]);

  useEffect(() => () => {
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  if (!open) return null;

  function updateTask(task: ClothingGenerationTask) {
    setTasks((current) => current.map((item) => item.planItemId === task.planItemId ? task : item));
  }

  async function generate(countOverride?: number) {
    setBusy(true);
    setError(null);
    try {
      const submitted = kind === "model"
        ? await api.submitCandidates("model", { ...modelRequest, ...(countOverride ? { count: countOverride } : {}) })
        : await api.submitCandidates("scene", { ...sceneRequest, ...(countOverride ? { count: countOverride } : {}) });
      setTasks(submitted);
      const completed = await runCandidateBatch({ tasks: submitted, api, onTaskChange: updateTask });
      const assets = completed.flatMap((task): ReferenceAsset[] => (
        task.status === "succeeded" && task.resultUrl && task.downloadToken
          ? [{
              id: task.planItemId,
              kind,
              source: "generated",
              previewUrl: task.resultUrl,
              downloadToken: task.downloadToken,
            }]
          : []
      ));
      setHistory((current) => [
        ...current.filter((asset) => !assets.some((next) => next.id === asset.id)),
        ...assets,
      ]);
      setTasks(completed.filter((task) => task.status !== "succeeded"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${name}候选生成失败`);
    } finally {
      setBusy(false);
    }
  }

  async function upload(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 15 * 1024 * 1024) {
      setError("仅支持 15 MB 以内的 JPG、PNG、WEBP 图片");
      return;
    }
    try {
      const processed = await preprocessClothingImage(file);
      const previewUrl = URL.createObjectURL(processed);
      objectUrls.current.push(previewUrl);
      const asset: ReferenceAsset = {
        id: `${kind}-upload-${crypto.randomUUID()}`,
        kind,
        source: "upload",
        previewUrl,
        file: processed,
      };
      setHistory((current) => [...current, asset]);
      setSelectedId(asset.id);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "参考图处理失败");
    }
  }

  const selected = history.find((asset) => asset.id === selectedId);
  return (
    <dialog open aria-modal="true" aria-label={`选择${name}图`} className="fixed inset-0 z-50 m-auto max-h-[92vh] w-[min(1040px,94vw)] overflow-hidden rounded-3xl border border-[#e1e3e8] bg-[#f8f8f9] p-0 text-[#17191d] shadow-2xl backdrop:bg-black/55">
      <div className="flex items-center justify-between border-b border-[#e1e3e8] bg-white px-6 py-4">
        <h2 className="text-lg font-semibold">AI 生成{name}图</h2>
        <button type="button" aria-label="关闭" onClick={onClose} className="text-xl text-[#666b75]">×</button>
      </div>
      <div className="grid max-h-[72vh] grid-cols-1 overflow-auto md:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5 p-6">
          {kind === "model" ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <label className={labelClass}>性别<select aria-label="性别" className={selectClass} value={modelRequest.gender} onChange={(event) => setModelRequest({ ...modelRequest, gender: event.currentTarget.value as ModelCandidateRequest["gender"] })}><option value="female">女性</option><option value="male">男性</option></select></label>
              <label className={labelClass}>年龄段<select aria-label="年龄段" className={selectClass} value={modelRequest.ageRange} onChange={(event) => setModelRequest({ ...modelRequest, ageRange: event.currentTarget.value as ModelCandidateRequest["ageRange"] })}><option value="18-25">18–25 岁</option><option value="26-35">26–35 岁</option><option value="36-45">36–45 岁</option><option value="46-plus">46 岁以上</option></select></label>
              <label className={labelClass}>肤色或地域外观<select aria-label="肤色或地域外观" className={selectClass} value={modelRequest.appearance} onChange={(event) => setModelRequest({ ...modelRequest, appearance: event.currentTarget.value as ModelCandidateRequest["appearance"] })}><option value="asian">亚洲人</option><option value="white">白人</option><option value="black">黑人</option><option value="latino">拉丁裔</option><option value="middle-eastern">中东人</option><option value="custom">自定义</option></select></label>
              <label className={labelClass}>体型<select aria-label="体型" className={selectClass} value={modelRequest.bodyType} onChange={(event) => setModelRequest({ ...modelRequest, bodyType: event.currentTarget.value as ModelCandidateRequest["bodyType"] })}><option value="slim">纤细</option><option value="regular">匀称</option><option value="curvy">曲线</option><option value="athletic">运动</option><option value="plus-size">大码</option></select></label>
              <label className={labelClass}>发型<select aria-label="发型" className={selectClass} value={modelRequest.hairstyle} onChange={(event) => setModelRequest({ ...modelRequest, hairstyle: event.currentTarget.value as ModelCandidateRequest["hairstyle"] })}><option value="short">短发</option><option value="medium">中长发</option><option value="long">长发</option><option value="tied">束发</option><option value="custom">自定义</option></select></label>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={labelClass}>风格感<select aria-label="风格感" className={selectClass} value={sceneRequest.style} onChange={(event) => setSceneRequest({ ...sceneRequest, style: event.currentTarget.value as SceneCandidateRequest["style"] })}><option value="mobile">手机网感</option><option value="editorial">杂志编辑风</option><option value="minimal">极简商业风</option><option value="luxury">轻奢质感</option><option value="lifestyle">生活方式感</option><option value="custom">自定义</option></select></label>
              <label className={labelClass}>推荐场地<select aria-label="推荐场地" className={selectClass} value={sceneRequest.venue} onChange={(event) => setSceneRequest({ ...sceneRequest, venue: event.currentTarget.value as SceneCandidateRequest["venue"] })}><option value="studio">摄影棚</option><option value="indoor">室内</option><option value="outdoor">户外</option><option value="street">街头</option><option value="home">居家</option><option value="custom">自定义</option></select></label>
              <label className={labelClass}>光线<select aria-label="光线" className={selectClass} value={sceneRequest.lighting} onChange={(event) => setSceneRequest({ ...sceneRequest, lighting: event.currentTarget.value as SceneCandidateRequest["lighting"] })}><option value="natural">自然光</option><option value="soft-studio">柔和棚拍光</option><option value="sunny">明亮阳光</option><option value="moody">氛围光</option><option value="custom">自定义</option></select></label>
              <label className={labelClass}>季节<select aria-label="季节" className={selectClass} value={sceneRequest.season} onChange={(event) => setSceneRequest({ ...sceneRequest, season: event.currentTarget.value as SceneCandidateRequest["season"] })}><option value="all">不限</option><option value="spring">春季</option><option value="summer">夏季</option><option value="autumn">秋季</option><option value="winter">冬季</option></select></label>
            </div>
          )}
          <label className={labelClass}>{kind === "model" ? "模特其他要求" : "场景其他要求"}
            <textarea aria-label={kind === "model" ? "模特其他要求" : "场景其他要求"} className="mt-1.5 min-h-24 w-full rounded-xl border border-[#d9dce3] bg-white p-3 text-sm" maxLength={1000} value={kind === "model" ? modelRequest.requirements : sceneRequest.requirements} onChange={(event) => kind === "model" ? setModelRequest({ ...modelRequest, requirements: event.currentTarget.value }) : setSceneRequest({ ...sceneRequest, requirements: event.currentTarget.value })} />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className={labelClass}>生成张数<select aria-label="生成张数" className={selectClass} value={kind === "model" ? modelRequest.count : sceneRequest.count} onChange={(event) => kind === "model" ? setModelRequest({ ...modelRequest, count: Number(event.currentTarget.value) }) : setSceneRequest({ ...sceneRequest, count: Number(event.currentTarget.value) })}>{[1, 2, 3, 4].map((count) => <option key={count} value={count}>{count} 张</option>)}</select></label>
            {kind === "scene" && <label className={labelClass}>最终图片比例<select aria-label="最终图片比例" className={selectClass} value={sceneRequest.aspectRatio} onChange={(event) => setSceneRequest({ ...sceneRequest, aspectRatio: event.currentTarget.value as SceneCandidateRequest["aspectRatio"] })}>{CLOTHING_RATIO_OPTIONS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>}
          </div>
          <button type="button" disabled={busy} onClick={() => void generate()} className="h-12 w-full rounded-xl bg-[#17191d] text-sm font-semibold text-white disabled:opacity-50">{busy ? "生成中…" : `立即生成${name}候选`}</button>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>

        <aside className="border-t border-[#e1e3e8] bg-white md:border-l md:border-t-0">
          <div className="grid grid-cols-2 gap-2 border-b border-[#e1e3e8] p-3">
            <button type="button" onClick={() => setTab("upload")} aria-pressed={tab === "upload"} className="rounded-xl px-3 py-2 text-sm aria-pressed:bg-[#f0efff]">上传</button>
            <button type="button" onClick={() => setTab("generate")} aria-pressed={tab === "generate"} className="rounded-xl px-3 py-2 text-sm aria-pressed:bg-[#17191d] aria-pressed:text-white">AI 生成</button>
          </div>
          <div className="space-y-3 p-4">
            {tab === "upload" && <label className="block rounded-xl border border-dashed border-[#cfd3dc] p-4 text-center text-sm"><input className="sr-only" aria-label={`上传${name}候选图`} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event.currentTarget.files?.[0])} />选择本地{name}图</label>}
            {history.map((asset) => (
              <button key={asset.id} type="button" aria-label={`选择${name}候选 ${asset.file?.name ?? asset.id}`} aria-pressed={selectedId === asset.id} onClick={() => setSelectedId(asset.id)} className="flex w-full items-center gap-3 rounded-xl border border-[#e1e3e8] p-2 text-left aria-pressed:border-[#6d5ce7] aria-pressed:ring-2 aria-pressed:ring-[#ded9ff]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={asset.previewUrl} alt="" className="size-16 rounded-lg bg-[#f2f3f5] object-cover" />
                <span className="min-w-0 text-xs text-[#666b75]">{asset.source === "upload" ? asset.file?.name : `AI 候选 · ${asset.id.slice(-6)}`}</span>
              </button>
            ))}
            {tasks.map((task) => (
              <div key={task.planItemId} className="rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                <p>{task.error ?? "候选生成中"}</p>
                {task.status === "failed" && <button type="button" onClick={() => void generate(1)} className="mt-2 rounded-lg border border-red-200 bg-white px-2 py-1">重试此候选</button>}
              </div>
            ))}
          </div>
        </aside>
      </div>
      <footer className="sticky bottom-0 flex justify-end gap-3 border-t border-[#e1e3e8] bg-white px-6 py-4">
        <button type="button" onClick={onClose} className="rounded-xl px-5 py-2.5 text-sm text-[#666b75]">取消</button>
        <button type="button" disabled={!selected} onClick={() => selected && onUse(selected)} className="rounded-xl bg-[#17191d] px-5 py-2.5 text-sm font-semibold text-white disabled:bg-[#b8bbc2]">使用选中的{name}</button>
      </footer>
    </dialog>
  );
}
