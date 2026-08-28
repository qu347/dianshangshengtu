import { expect, it } from "vitest";
import { initialClothingStudioState, clothingStudioReducer } from "./state";
import { defaultClothingSettings, makeClothingAnalysis } from "./test-fixtures";

const model = {
  id: "model", kind: "model" as const, source: "generated" as const,
  previewUrl: "/model", downloadToken: "token",
};

it("invalidates analysis and tasks when any generation input changes", () => {
  const planned = {
    ...initialClothingStudioState,
    phase: "reviewing_plan" as const,
    analysis: makeClothingAnalysis(2),
    tasks: [{ planItemId: "1", status: "running" as const, progress: 20 }],
  };
  const afterModel = clothingStudioReducer(planned, { type: "model_changed", model });
  expect(afterModel).toMatchObject({ phase: "input", analysis: null, tasks: [] });
  const afterSettings = clothingStudioReducer(planned, {
    type: "settings_changed", patch: { watermark: "品牌" },
  });
  expect(afterSettings.settings.watermark).toBe("品牌");
  expect(afterSettings.analysis).toBeNull();
  const afterRequirements = clothingStudioReducer(planned, {
    type: "requirements_changed", requirements: "新要求",
  });
  expect(afterRequirements.analysis).toBeNull();
});

it("moves through analysis and two-stage generation phases", () => {
  let state = clothingStudioReducer(initialClothingStudioState, { type: "analysis_started" });
  expect(state.phase).toBe("analyzing");
  state = clothingStudioReducer(state, { type: "analysis_succeeded", analysis: makeClothingAnalysis(2) });
  expect(state.phase).toBe("reviewing_plan");
  state = clothingStudioReducer(state, { type: "generation_started", tasks: [] });
  expect(state.phase).toBe("generating_main");
  state = clothingStudioReducer(state, { type: "generation_set_started" });
  expect(state.phase).toBe("generating_set");
  state = clothingStudioReducer(state, { type: "generation_completed" });
  expect(state.phase).toBe("completed");
  expect(state.settings).toEqual(defaultClothingSettings);
});

it("restores a saved workspace without fabricating files or candidate history", () => {
  const state = clothingStudioReducer(initialClothingStudioState, {
    type: "session_restored",
    session: {
      settings: defaultClothingSettings,
      analysis: makeClothingAnalysis(2),
      tasks: [{ planItemId: "1", providerJobId: "opaque", status: "timed_out", progress: 50 }],
      recovered: true,
    },
  });
  expect(state.phase).toBe("completed");
  expect(state.garments).toEqual([]);
  expect(state.selectedModel).toBeNull();
  expect(state.recovered).toBe(true);
});

