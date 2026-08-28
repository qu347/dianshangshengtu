import { expect, it, vi } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "../test-fixtures";
import type { ClothingGenerationTask, ClothingPlanItem, ReferenceAsset } from "../model";
import { runClothingGenerationBatch } from "./generation-runner";

const garment = new File(["garment"], "garment.webp", { type: "image/webp" });
const model: ReferenceAsset = {
  id: "model", kind: "model", source: "generated", previewUrl: "/model", downloadToken: "model-token",
};

function succeeded(item: ClothingPlanItem, token = `token-${item.id}`): ClothingGenerationTask {
  return {
    planItemId: item.id,
    status: "succeeded",
    progress: 100,
    resultUrl: `http://localhost/${item.id}.png`,
    downloadToken: token,
  };
}

it("retries a white-background image-one failure once before starting later images", async () => {
  const [first, second] = makeClothingAnalysis(2).plan;
  let imageOneAttempts = 0;
  const api = {
    submit: vi.fn(async ({ item, baseImageToken }: { item: ClothingPlanItem; baseImageToken?: string }) => {
      if (item.id === "1") {
        imageOneAttempts += 1;
        return imageOneAttempts === 1
          ? { planItemId: "1", status: "failed" as const, progress: 100, error: "白底服装主图背景处理失败，请重试此图" }
          : succeeded(first, "main-token");
      }
      expect(baseImageToken).toBe("main-token");
      return succeeded(second);
    }),
    status: vi.fn(),
  };

  const tasks = await runClothingGenerationBatch({
    items: [first, second], garments: [garment], settings: defaultClothingSettings,
    model, api, onTaskChange: vi.fn(),
  });

  expect(api.submit.mock.calls.map(([input]) => input.item.id)).toEqual(["1", "1", "2"]);
  expect(tasks.map((task) => task.status)).toEqual(["succeeded", "succeeded"]);
});

it("blocks all dependent images after two white-background failures", async () => {
  const items = makeClothingAnalysis(4).plan;
  const changes: ClothingGenerationTask[] = [];
  const api = {
    submit: vi.fn(async ({ item }: { item: ClothingPlanItem }) => ({
      planItemId: item.id,
      status: "failed" as const,
      progress: 100,
      error: "白底商品主图背景处理失败，请重试此图",
    })),
    status: vi.fn(),
  };
  const tasks = await runClothingGenerationBatch({
    items, garments: [garment], settings: { ...defaultClothingSettings, imageCount: 4 },
    model, api, onTaskChange: (task) => changes.push(task),
  });

  expect(api.submit).toHaveBeenCalledTimes(2);
  expect(tasks.slice(1).every((task) => task.error === "请先生成或重试白底立体服装主图")).toBe(true);
  expect(changes).toEqual(expect.arrayContaining([
    expect.objectContaining({ planItemId: "4", status: "failed" }),
  ]));
});

it("does not retry moderation failures", async () => {
  const items = makeClothingAnalysis(2).plan;
  const api = {
    submit: vi.fn(async ({ item }: { item: ClothingPlanItem }) => ({
      planItemId: item.id, status: "failed" as const, progress: 0, error: "图片未通过内容审核",
    })),
    status: vi.fn(),
  };
  await runClothingGenerationBatch({
    items, garments: [garment], settings: defaultClothingSettings, model,
    api, onTaskChange: vi.fn(),
  });
  expect(api.submit).toHaveBeenCalledTimes(1);
});

it("runs at most three later images concurrently and isolates sibling failures", async () => {
  const items = makeClothingAnalysis(6).plan;
  let active = 0;
  let maximum = 0;
  const api = {
    submit: vi.fn(async ({ item }: { item: ClothingPlanItem }) => {
      if (item.id === "1") return succeeded(item, "main-token");
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      if (item.id === "3") throw new Error("单张生成失败");
      return succeeded(item);
    }),
    status: vi.fn(),
  };
  const tasks = await runClothingGenerationBatch({
    items, garments: [garment], settings: { ...defaultClothingSettings, imageCount: 6 },
    model, api, onTaskChange: vi.fn(),
  });
  expect(maximum).toBe(3);
  expect(tasks.find((task) => task.planItemId === "3")).toMatchObject({ status: "failed" });
  expect(tasks.find((task) => task.planItemId === "4")).toMatchObject({ status: "succeeded" });
});

it("reuses the original plan and main token for a single later-image retry", async () => {
  const second = makeClothingAnalysis(2).plan[1];
  const api = { submit: vi.fn(async () => succeeded(second)), status: vi.fn() };
  await runClothingGenerationBatch({
    items: [second], garments: [garment], settings: defaultClothingSettings,
    model, baseImageToken: "existing-main-token", api, onTaskChange: vi.fn(),
  });
  expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({
    item: second,
    baseImageToken: "existing-main-token",
    model,
  }));
});
