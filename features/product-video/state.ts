import type { IntroScript, VideoIntroSettings, VideoIntroTask } from "./model";
import { VideoIntroSettingsSchema } from "./model";

export type ProductVideoPhase =
  | "input"
  | "analyzing"
  | "reviewing_script"
  | "generating"
  | "completed"
  | "partial_failed"
  | "failed"
  | "cancelled";

export type ProductVideoState = {
  phase: ProductVideoPhase;
  productImages: File[];
  productName: string;
  requirements: string;
  settings: VideoIntroSettings;
  script: IntroScript | null;
  tasks: VideoIntroTask[];
  notice: string | null;
};

export const initialProductVideoState: ProductVideoState = {
  phase: "input",
  productImages: [],
  productName: "",
  requirements: "",
  settings: { aspectRatio: "9:16", durationSec: 10, resolution: "480p", language: "zh-CN" },
  script: null,
  tasks: [],
  notice: null,
};

export type ProductVideoAction =
  | { type: "images_changed"; images: File[] }
  | { type: "text_changed"; productName?: string; requirements?: string }
  | { type: "settings_changed"; patch: Partial<VideoIntroSettings> }
  | { type: "analyze_started" }
  | { type: "analyze_succeeded"; script: IntroScript }
  | { type: "analyze_failed"; message: string }
  | { type: "script_changed"; script: IntroScript }
  | { type: "generation_started"; tasks: VideoIntroTask[] }
  | { type: "shot_retry_started"; shotId: string }
  | { type: "shot_changed"; task: VideoIntroTask }
  | { type: "generation_completed"; tasks: VideoIntroTask[] }
  | { type: "generation_cancelled"; tasks: VideoIntroTask[] }
  | { type: "notice"; message: string | null };

export function productVideoReducer(state: ProductVideoState, action: ProductVideoAction): ProductVideoState {
  if (action.type === "images_changed") {
    return { ...state, productImages: action.images, phase: "input", script: null, tasks: [] };
  }
  if (action.type === "text_changed") {
    return { ...state, productName: action.productName ?? state.productName, requirements: action.requirements ?? state.requirements };
  }
  if (action.type === "settings_changed") {
    const settings = VideoIntroSettingsSchema.parse({ ...state.settings, ...action.patch });
    return { ...state, settings, script: null, tasks: [], notice: state.script ? "生成设置已变化，请重新分析" : state.notice };
  }
  if (action.type === "analyze_started") {
    return { ...state, phase: "analyzing", notice: null };
  }
  if (action.type === "analyze_succeeded") {
    return { ...state, phase: "reviewing_script", script: action.script, tasks: [], notice: null };
  }
  if (action.type === "analyze_failed") {
    return { ...state, phase: state.script ? "reviewing_script" : "input", notice: action.message };
  }
  if (action.type === "script_changed") {
    return { ...state, script: action.script };
  }
  if (action.type === "generation_started") {
    return { ...state, phase: "generating", tasks: action.tasks, notice: null };
  }
  if (action.type === "shot_retry_started") {
    return {
      ...state,
      phase: "generating",
      notice: null,
      tasks: state.tasks.map((task) => task.shotId === action.shotId
        ? { shotId: task.shotId, status: "queued", progress: 0 }
        : task),
    };
  }
  if (action.type === "shot_changed") {
    return { ...state, phase: "generating", tasks: state.tasks.map((task) => task.shotId === action.task.shotId ? action.task : task) };
  }
  if (action.type === "generation_completed") {
    const failedCount = action.tasks.filter((task) => task.status === "failed").length;
    const phase = failedCount === 0
      ? "completed"
      : failedCount === action.tasks.length
        ? "failed"
        : "partial_failed";
    return { ...state, phase, tasks: action.tasks };
  }
  if (action.type === "generation_cancelled") {
    const tasks = action.tasks.map((task) => (
      task.status === "queued" || task.status === "submitting" || task.status === "running"
        ? { ...task, status: "failed" as const, error: "已取消，可重试" }
        : task
    ));
    return { ...state, phase: "cancelled", tasks, notice: "已取消未完成的视频生成" };
  }
  if (action.type === "notice") {
    return { ...state, notice: action.message };
  }
  return state;
}

export function defaultShotTasks(script: IntroScript): VideoIntroTask[] {
  return script.shots.map((shot) => ({ shotId: shot.id, status: "queued" as const, progress: 0 }));
}
