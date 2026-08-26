import { expect, it } from "vitest";
import { initialProductStudioState, productStudioReducer } from "./state";

it("clears analysis and tasks when the watermark changes", () => {
  const withPlan = { ...initialProductStudioState, phase: "reviewing_plan" as const, analysis: { plan: [{ id: "1" }] } as never, tasks: [{ planItemId: "1", status: "running" as const, progress: 20 }] };
  const next = productStudioReducer(withPlan, { type: "settings_changed", patch: { watermark: "My Shop" } });
  expect(next.settings.watermark).toBe("My Shop"); expect(next.phase).toBe("input"); expect(next.analysis).toBeNull(); expect(next.tasks).toEqual([]); expect(next.notice).toBe("关键参数已变化，请重新分析产品");
});

it("invalidates analysis when product facts change", () => {
  const withPlan = { ...initialProductStudioState, phase: "reviewing_plan" as const, productName: "旧名称", analysis: { plan: [{ id: "1" }] } as never };
  const next = productStudioReducer(withPlan, { type: "text_changed", productName: "新名称" });
  expect(next.phase).toBe("input"); expect(next.analysis).toBeNull(); expect(next.notice).toBe("产品信息已变化，请重新分析产品");
});

it("invalidates analysis when product dimensions change", () => {
  const withPlan = { ...initialProductStudioState, phase: "reviewing_plan" as const, analysis: { plan: [{ id: "1" }] } as never, tasks: [{ planItemId: "1", status: "running" as const, progress: 20 }] };
  const dimensions = [{ id: "height", label: "杯高", value: 12, unit: "cm" as const }];
  const next = productStudioReducer(withPlan, { type: "dimensions_changed", dimensions });
  expect(next.dimensions).toEqual(dimensions); expect(next.phase).toBe("input"); expect(next.analysis).toBeNull(); expect(next.tasks).toEqual([]); expect(next.notice).toBe("产品尺寸已变化，请重新分析产品");
});

it("updates one task without replacing the remaining tasks", () => {
  const state = { ...initialProductStudioState, tasks: [{ planItemId: "1", status: "running" as const, progress: 10 }, { planItemId: "2", status: "queued" as const, progress: 0 }] };
  const next = productStudioReducer(state, { type: "task_changed", task: { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "https://example.com/1.png", downloadToken: "token" } });
  expect(next.tasks[0].status).toBe("succeeded"); expect(next.tasks[1].status).toBe("queued");
});
