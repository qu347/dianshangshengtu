import type { SceneScript, VideoRemakeSettings, VideoSceneTask, VideoScript } from "./model";
import { VideoRemakeSettingsSchema } from "./model";

export type VideoRemakePhase =
  | "input"
  | "analyzing"
  | "reviewing_script"
  | "generating"
  | "completed";

export type VideoRemakeState = {
  phase: VideoRemakePhase;
  referenceVideo: File | null;
  frames: Array<{ file: File; atSec: number }>;
  videoDurationSec: number;
  modelImage: File | null;
  productImages: File[];
  productName: string;
  requirements: string;
  settings: VideoRemakeSettings;
  script: VideoScript | null;
  tasks: VideoSceneTask[];
  notice: string | null;
};

export const initialVideoRemakeState: VideoRemakeState = {
  phase: "input",
  referenceVideo: null,
  frames: [],
  videoDurationSec: 0,
  modelImage: null,
  productImages: [],
  productName: "",
  requirements: "",
  settings: { aspectRatio: "9:16", durationSec: 15, language: "zh-CN", quality: "480p" },
  script: null,
  tasks: [],
  notice: null,
};

export type VideoRemakeAction =
  | { type: "video_changed"; video: File | null; frames: Array<{ file: File; atSec: number }>; videoDurationSec: number }
  | { type: "model_image_changed"; image: File | null }
  | { type: "product_images_changed"; images: File[] }
  | { type: "text_changed"; productName?: string; requirements?: string }
  | { type: "settings_changed"; patch: Partial<VideoRemakeSettings> }
  | { type: "analyze_started" }
  | { type: "analyze_succeeded"; script: VideoScript }
  | { type: "analyze_failed"; message: string }
  | { type: "script_changed"; script: VideoScript }
  | { type: "generation_started"; tasks: VideoSceneTask[] }
  | { type: "scene_retry_started"; sceneId: string }
  | { type: "scene_changed"; task: VideoSceneTask }
  | { type: "generation_completed" }
  | { type: "generation_cancelled" }
  | { type: "notice"; message: string | null };

export function videoRemakeReducer(state: VideoRemakeState, action: VideoRemakeAction): VideoRemakeState {
  if (action.type === "video_changed") {
    return { ...state, referenceVideo: action.video, frames: action.frames, videoDurationSec: action.videoDurationSec, phase: "input", script: null, tasks: [] };
  }
  if (action.type === "model_image_changed") {
    return { ...state, modelImage: action.image };
  }
  if (action.type === "product_images_changed") {
    return { ...state, productImages: action.images };
  }
  if (action.type === "text_changed") {
    return { ...state, productName: action.productName ?? state.productName, requirements: action.requirements ?? state.requirements };
  }
  if (action.type === "settings_changed") {
    const settings = VideoRemakeSettingsSchema.parse({ ...state.settings, ...action.patch });
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
  if (action.type === "scene_retry_started") {
    return {
      ...state,
      phase: "generating",
      notice: null,
      tasks: state.tasks.map((task) => task.sceneId === action.sceneId
        ? { sceneId: task.sceneId, status: "queued", progress: 0 }
        : task),
    };
  }
  if (action.type === "scene_changed") {
    return { ...state, phase: "generating", tasks: state.tasks.map((task) => task.sceneId === action.task.sceneId ? action.task : task) };
  }
  if (action.type === "generation_completed") {
    return { ...state, phase: "completed" };
  }
  if (action.type === "generation_cancelled") {
    return { ...state, phase: "completed", notice: "已取消未完成的分镜生成" };
  }
  if (action.type === "notice") {
    return { ...state, notice: action.message };
  }
  return state;
}

export function defaultSceneTasks(script: VideoScript): VideoSceneTask[] {
  return script.scenes.map((scene: SceneScript) => ({ sceneId: scene.id, status: "queued" as const, progress: 0 }));
}
