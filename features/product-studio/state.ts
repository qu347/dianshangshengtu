import type { DimensionItem, GenerationSettings, GenerationTask, ProductAnalysis } from "./model";

export type ProductStudioPhase = "input" | "analyzing" | "reviewing_plan" | "submitting" | "generating" | "completed";
export type ProductStudioState = { phase: ProductStudioPhase; files: File[]; settings: GenerationSettings; productName: string; dimensions: DimensionItem[]; requirements: string; analysis: ProductAnalysis | null; tasks: GenerationTask[]; notice: string | null };
export const initialProductStudioState: ProductStudioState = { phase: "input", files: [], settings: { platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto", watermark: "", generateDimensionImage: true }, productName: "", dimensions: [{ id: "initial-dimension", label: "", value: 0, unit: "cm" }], requirements: "", analysis: null, tasks: [], notice: null };
export type ProductStudioAction =
  | { type: "files_changed"; files: File[] } | { type: "settings_changed"; patch: Partial<GenerationSettings> } | { type: "text_changed"; productName?: string; requirements?: string } | { type: "dimensions_changed"; dimensions: DimensionItem[] }
  | { type: "analysis_started" } | { type: "analysis_succeeded"; analysis: ProductAnalysis } | { type: "analysis_failed"; message: string } | { type: "plan_changed"; analysis: ProductAnalysis }
  | { type: "generation_started"; tasks: GenerationTask[] } | { type: "task_changed"; task: GenerationTask } | { type: "generation_completed" };

export function productStudioReducer(state: ProductStudioState, action: ProductStudioAction): ProductStudioState {
  if (action.type === "files_changed") return { ...state, files: action.files, phase: "input", analysis: null, tasks: [], notice: state.analysis ? "产品图片已变化，请重新分析产品" : null };
  if (action.type === "settings_changed") return { ...state, settings: { ...state.settings, ...action.patch }, phase: "input", analysis: null, tasks: [], notice: state.analysis ? "关键参数已变化，请重新分析产品" : null };
  if (action.type === "text_changed") return { ...state, productName: action.productName ?? state.productName, requirements: action.requirements ?? state.requirements, phase: state.analysis ? "input" : state.phase, analysis: state.analysis ? null : state.analysis, tasks: state.analysis ? [] : state.tasks, notice: state.analysis ? "产品信息已变化，请重新分析产品" : state.notice };
  if (action.type === "dimensions_changed") return { ...state, dimensions: action.dimensions, phase: "input", analysis: null, tasks: [], notice: state.analysis ? "产品尺寸已变化，请重新分析产品" : null };
  if (action.type === "analysis_started") return { ...state, phase: "analyzing", notice: null };
  if (action.type === "analysis_succeeded") return { ...state, phase: "reviewing_plan", analysis: action.analysis, tasks: [], notice: null };
  if (action.type === "analysis_failed") return { ...state, phase: state.analysis ? "reviewing_plan" : "input", notice: action.message };
  if (action.type === "plan_changed") return { ...state, analysis: action.analysis };
  if (action.type === "generation_started") return { ...state, phase: "submitting", tasks: action.tasks, notice: null };
  if (action.type === "task_changed") return { ...state, phase: "generating", tasks: state.tasks.map((task) => task.planItemId === action.task.planItemId ? action.task : task) };
  if (action.type === "generation_completed") return { ...state, phase: "completed" };
  return state;
}
