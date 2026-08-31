"use client";

import { VideoScriptSchema, type VideoRemakeSettings, type VideoScript } from "../model";

type ScriptEditorProps = {
  script: VideoScript;
  settings: VideoRemakeSettings;
  disabled?: boolean;
  onChange: (script: VideoScript) => void;
  onReanalyze: () => void;
  onConfirm: () => void;
};

export function ScriptEditor({ script, settings, disabled = false, onChange, onReanalyze, onConfirm }: ScriptEditorProps) {
  function updateScene(index: number, patch: Partial<VideoScript["scenes"][number]>) {
    onChange({ ...script, scenes: script.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene) });
  }

  const totalSeconds = script.scenes.reduce((sum, scene) => sum + scene.durationSec, 0);
  const canConfirm = VideoScriptSchema(settings.durationSec).safeParse(script).success;

  return (
    <section aria-labelledby="video-script-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[#7b808b]">VIDEO SCRIPT</p>
          <h2 id="video-script-title" className="mt-1 text-base font-semibold">分镜脚本</h2>
        </div>
        <span className="text-xs text-[#777c86]">共 {script.scenes.length} 个分镜，合计 {totalSeconds} 秒，可逐项修改</span>
      </div>

      <p className="mt-3 rounded-lg bg-[#f7f7fb] px-3 py-2 text-xs leading-5 text-[#4f535c]" aria-label="风格摘要">{script.styleNotes}</p>

      <div className="mt-4 space-y-3">
        {script.scenes.map((scene, index) => (
          <article key={scene.id} className="rounded-xl border border-[#e0e3e9] bg-white p-4" aria-labelledby={`video-scene-${scene.id}`}>
            <div className="flex items-center justify-between gap-3">
              <h3 id={`video-scene-${scene.id}`} className="font-semibold text-[#292c32]">第 {String(index + 1).padStart(2, "0")} 镜 · {scene.title}</h3>
              <label className="text-xs text-[#5f646e]">
                时长
                <input aria-label={`第 ${index + 1} 镜时长`} className="ml-2 h-8 w-20 rounded-lg border border-[#d8dbe2] px-2 text-sm" type="number" min={5} max={15} disabled={disabled} value={scene.durationSec} onChange={(event) => {
                  const durationSec = Number(event.currentTarget.value);
                  if (Number.isInteger(durationSec) && durationSec >= 5 && durationSec <= 15) updateScene(index, { durationSec });
                }} />
                <span className="ml-1">秒</span>
              </label>
            </div>
            <label className="mt-3 block text-xs font-medium text-[#5f646e]">
              画面与运镜（中文）
              <textarea className="mt-1.5 block min-h-20 w-full resize-y rounded-lg border border-[#d8dbe2] bg-white px-3 py-2 text-sm leading-6" disabled={disabled} value={scene.description} onChange={(event) => updateScene(index, { description: event.currentTarget.value })} />
            </label>
            <label className="mt-2 block text-xs font-medium text-[#5f646e]">
              叠层文字（{settings.language}，可留空）
              <input className="mt-1.5 block h-9 w-full rounded-lg border border-[#d8dbe2] bg-white px-2.5 text-sm" maxLength={80} disabled={disabled} value={scene.onScreenText} onChange={(event) => updateScene(index, { onScreenText: event.currentTarget.value })} />
            </label>
          </article>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-3 border-t border-[#e8eaee] pt-4">
        <button className="rounded-lg border border-[#d5d8df] bg-white px-4 py-2.5 text-sm font-medium text-[#343840] transition hover:bg-[#f6f7f9] disabled:opacity-50" type="button" disabled={disabled} onClick={onReanalyze}>重新分析</button>
        <button className="rounded-lg bg-[#17191d] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40" type="button" onClick={onConfirm} disabled={disabled || !canConfirm}>确认脚本并生成视频</button>
      </div>
    </section>
  );
}
