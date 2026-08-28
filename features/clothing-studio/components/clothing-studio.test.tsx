import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "../test-fixtures";
import type { ClothingStudioApi } from "../lib/client-api";
import { saveClothingSession } from "../lib/session-store";
import { ClothingStudio } from "./clothing-studio";

vi.mock("../lib/image-files", () => ({
  validateGarmentFiles: vi.fn((files: File[]) => files.length ? [] : ["请至少上传 1 张服装图"]),
  preprocessClothingImage: vi.fn(async (file: File) => file),
}));

function createApi() {
  const analysis = makeClothingAnalysis(2);
  return {
    analyze: vi.fn(async () => analysis),
    submitCandidates: vi.fn(async () => [{
      planItemId: "model-1",
      status: "succeeded" as const,
      progress: 100,
      resultUrl: "/api/clothing/download?model",
      downloadToken: "model-token",
    }]),
    submit: vi.fn(async ({ item, baseImageToken }: { item: { id: string }; baseImageToken?: string }) => ({
      planItemId: item.id,
      status: "succeeded" as const,
      progress: 100,
      resultUrl: `/api/clothing/download?image=${item.id}`,
      downloadToken: item.id === "1" ? "main-token" : `token-${item.id}-${baseImageToken}`,
    })),
    status: vi.fn(),
  } as unknown as ClothingStudioApi;
}

afterEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

it("requires a model, supports an optional scene, then preserves two-stage submission order", async () => {
  const user = userEvent.setup();
  const api = createApi();
  render(<ClothingStudio api={api} />);
  expect(screen.getByText(/AI 会先生成纯白立体服装主图/)).toBeVisible();
  expect(screen.getByText("可选 · 统一整组场景风格")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "开始分析服装" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请选择模特图");

  await user.click(screen.getByRole("button", { name: "AI 生成模特图" }));
  await user.click(screen.getByRole("button", { name: "立即生成模特候选" }));
  await user.click(await screen.findByRole("button", { name: /选择模特候选 model-1/ }));
  await user.click(screen.getByRole("button", { name: "使用选中的模特" }));
  await user.upload(screen.getByLabelText("上传服装图"), new File(["x"], "top.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "开始分析服装" }));
  expect(await screen.findByRole("button", { name: "确认规划并生成" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "确认规划并生成" }));

  await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.submit).mock.calls[0][0].item.id).toBe("1");
  expect(vi.mocked(api.submit).mock.calls[1][0]).toEqual(expect.objectContaining({
    baseImageToken: "main-token",
    model: expect.objectContaining({ downloadToken: "model-token" }),
  }));
  expect(await screen.findAllByRole("button", { name: /下载第 .* 张/ })).toHaveLength(2);
});

it("invalidates an existing plan when generation settings change", async () => {
  const user = userEvent.setup();
  const api = createApi();
  render(<ClothingStudio api={api} />);
  await user.click(screen.getByRole("button", { name: "AI 生成模特图" }));
  await user.click(screen.getByRole("button", { name: "立即生成模特候选" }));
  await user.click(await screen.findByRole("button", { name: /选择模特候选 model-1/ }));
  await user.click(screen.getByRole("button", { name: "使用选中的模特" }));
  await user.upload(screen.getByLabelText("上传服装图"), new File(["x"], "top.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "开始分析服装" }));
  expect(await screen.findByText("生成规划")).toBeVisible();
  await user.type(screen.getByLabelText("自定义水印"), "品牌");
  expect(screen.queryByText("生成规划")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("请重新分析服装");
});

it("restores a saved task without restoring local files or retry authority", async () => {
  saveClothingSession({
    settings: defaultClothingSettings,
    analysis: makeClothingAnalysis(2),
    tasks: [{ planItemId: "1", status: "failed", progress: 0, error: "失败" }],
  });
  render(<ClothingStudio api={createApi()} />);
  expect(await screen.findByText(/已恢复上次任务/)).toBeVisible();
  expect(screen.getByRole("button", { name: "重试第 1 张" })).toBeDisabled();
  expect(screen.getByText("0 / 6")).toBeVisible();
});
