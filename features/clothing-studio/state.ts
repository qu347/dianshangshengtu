import type {
  ClothingAnalysis,
  ClothingGenerationSettings,
  ClothingGenerationTask,
  ReferenceAsset,
} from "./model";
import type { ClothingSession } from "./lib/session-store";

export type ClothingStudioPhase =
  | "input"
  | "analyzing"
  | "reviewing_plan"
  | "generating_main"
  | "generating_set"
  | "completed";

export type ClothingStudioState = {
  phase: ClothingStudioPhase;
  garments: File[];
  selectedModel: ReferenceAsset | null;
  selectedScene: ReferenceAsset | null;
  settings: ClothingGenerationSettings;
  requirements: string;
  analysis: ClothingAnalysis | null;
  tasks: ClothingGenerationTask[];
  notice: string | null;
  recovered: boolean;
};

export const initialClothingStudioState: ClothingStudioState = {
  phase: "input",
  garments: [],
  selectedModel: null,
  selectedScene: null,
  settings: {
    platform: "taobao",
    language: "zh-CN",
    aspectRatio: "1090x1443",
    imageCount: 2,
    quality: "auto",
    watermark: "",
  },
  requirements: "",
  analysis: null,
  tasks: [],
  notice: null,
  recovered: false,
};

export type ClothingStudioAction =
  | { type: "garments_changed"; garments: File[] }
  | { type: "model_changed"; model: ReferenceAsset | null }
  | { type: "scene_changed"; scene: ReferenceAsset | null }
  | { type: "settings_changed"; patch: Partial<ClothingGenerationSettings> }
  | { type: "requirements_changed"; requirements: string }
  | { type: "analysis_started" }
  | { type: "analysis_succeeded"; analysis: ClothingAnalysis }
  | { type: "analysis_failed"; message: string }
  | { type: "plan_changed"; analysis: ClothingAnalysis }
  | { type: "generation_started"; tasks: ClothingGenerationTask[] }
  | { type: "generation_set_started" }
  | { type: "task_changed"; task: ClothingGenerationTask }
  | { type: "generation_completed" }
  | { type: "session_restored"; session: ClothingSession & { recovered: true } };

function invalidate(state: ClothingStudioState, patch: Partial<ClothingStudioState>) {
  return {
    ...state,
    ...patch,
    phase: "input" as const,
    analysis: null,
    tasks: [],
    notice: state.analysis ? "输入已变化，请重新分析服装" : null,
    recovered: false,
  };
}

export function clothingStudioReducer(
  state: ClothingStudioState,
  action: ClothingStudioAction,
): ClothingStudioState {
  if (action.type === "garments_changed") return invalidate(state, { garments: action.garments });
  if (action.type === "model_changed") return invalidate(state, { selectedModel: action.model });
  if (action.type === "scene_changed") return invalidate(state, { selectedScene: action.scene });
  if (action.type === "settings_changed") {
    return invalidate(state, { settings: { ...state.settings, ...action.patch } });
  }
  if (action.type === "requirements_changed") return invalidate(state, { requirements: action.requirements });
  if (action.type === "analysis_started") return { ...state, phase: "analyzing", notice: null };
  if (action.type === "analysis_succeeded") {
    return { ...state, phase: "reviewing_plan", analysis: action.analysis, tasks: [], notice: null };
  }
  if (action.type === "analysis_failed") {
    return { ...state, phase: state.analysis ? "reviewing_plan" : "input", notice: action.message };
  }
  if (action.type === "plan_changed") return { ...state, analysis: action.analysis };
  if (action.type === "generation_started") {
    return { ...state, phase: "generating_main", tasks: action.tasks, notice: null };
  }
  if (action.type === "generation_set_started") return { ...state, phase: "generating_set" };
  if (action.type === "task_changed") {
    const exists = state.tasks.some((task) => task.planItemId === action.task.planItemId);
    return {
      ...state,
      tasks: exists
        ? state.tasks.map((task) => task.planItemId === action.task.planItemId ? action.task : task)
        : [...state.tasks, action.task],
    };
  }
  if (action.type === "generation_completed") return { ...state, phase: "completed" };
  if (action.type === "session_restored") {
    return {
      ...initialClothingStudioState,
      phase: "completed",
      settings: action.session.settings,
      analysis: action.session.analysis,
      tasks: action.session.tasks,
      recovered: true,
      notice: "已恢复上次任务；重试生图前请重新选择服装、模特和场景图",
    };
  }
  return state;
}
