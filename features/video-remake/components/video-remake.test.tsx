import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VideoRemake } from "./video-remake";
import { analyzeScriptClient } from "../lib/client";
import { runSceneBatch } from "../lib/scene-runner";
import { extractVideoFrames } from "../lib/frames";
import { preprocessProductImage } from "@/features/product-studio/lib/image-files";
import { submitClothingCandidatesClient } from "@/features/clothing-studio/lib/client-api";

vi.mock("../lib/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/client")>()),
  analyzeScriptClient: vi.fn(),
  getSceneStatusClient: vi.fn(),
  submitSceneClient: vi.fn(),
}));

vi.mock("../lib/scene-runner", () => ({ runSceneBatch: vi.fn().mockResolvedValue([]) }));
vi.mock("../lib/frames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/frames")>()),
  extractVideoFrames: vi.fn(),
}));
vi.mock("@/features/product-studio/lib/image-files", () => ({
  validateProductFiles: vi.fn(() => []),
  preprocessProductImage: vi.fn(),
}));
vi.mock("@/features/clothing-studio/lib/client-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/clothing-studio/lib/client-api")>()),
  submitClothingCandidatesClient: vi.fn(),
  getClothingGenerationStatusClient: vi.fn(),
}));
vi.mock("@/features/clothing-studio/lib/image-files", () => ({
  preprocessClothingImage: vi.fn(async (file: File) => file),
}));
vi.mock("./script-editor", () => ({
  ScriptEditor: ({ onConfirm }: { onConfirm: () => void }) => <button type="button" onClick={onConfirm}>生成分镜</button>,
}));

it("shows the decoded over-90-second error without starting analysis or generation", async () => {
  const referenceVideo = new File(["reference"], "too-long.mp4", { type: "video/mp4" });
  vi.mocked(extractVideoFrames).mockRejectedValueOnce(new Error("参考视频不能超过 90 秒"));

  render(<VideoRemake />);
  fireEvent.change(screen.getByLabelText("上传参考视频"), { target: { files: [referenceVideo] } });

  expect(await screen.findByRole("alert")).toHaveTextContent("参考视频不能超过 90 秒");
  expect(analyzeScriptClient).not.toHaveBeenCalled();
  expect(runSceneBatch).not.toHaveBeenCalled();
});

it("passes the selected normalized model image to scene generation", async () => {
  const referenceVideo = new File(["reference"], "reference.mp4", { type: "video/mp4" });
  const productImage = new File(["product"], "product.png", { type: "image/png" });
  const modelImage = new File(["model"], "model.png", { type: "image/png" });
  const normalizedProduct = new File(["normalized-product"], "product.webp", { type: "image/webp" });
  const normalizedModel = new File(["normalized-model"], "model.webp", { type: "image/webp" });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:normalized-model");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  vi.mocked(extractVideoFrames).mockResolvedValue(Object.assign([
    { file: new File(["frame"], "frame.jpg", { type: "image/jpeg" }), atSec: 4 },
  ], { durationSec: 5 }));
  vi.mocked(preprocessProductImage).mockResolvedValueOnce(normalizedProduct).mockResolvedValueOnce(normalizedModel);
  vi.mocked(analyzeScriptClient).mockResolvedValue({
    styleNotes: "warm studio",
    scenes: [{ id: "1", title: "opening", description: "product closeup", onScreenText: "", durationSec: 15 }],
  });

  render(<VideoRemake />);
  fireEvent.change(screen.getByLabelText("上传参考视频"), { target: { files: [referenceVideo] } });
  await screen.findByText("已抽取 1 帧画面用于分析。");
  fireEvent.click(screen.getByRole("button", { name: "开始分析视频" }));
  await screen.findByRole("button", { name: "生成分镜" });
  fireEvent.change(screen.getByLabelText("上传商品图"), { target: { files: [productImage] } });
  await screen.findByText("已选择 1 张商品图。");
  fireEvent.change(screen.getByLabelText("选择本地模特图文件"), { target: { files: [modelImage] } });
  await screen.findByRole("img", { name: "已选模特图" });
  fireEvent.click(screen.getByRole("button", { name: "生成分镜" }));

  await waitFor(() => expect(runSceneBatch).toHaveBeenCalledWith(expect.objectContaining({
    modelImage: expect.objectContaining({
      kind: "model",
      source: "upload",
      previewUrl: "blob:normalized-model",
      file: normalizedModel,
    }),
    signal: expect.any(AbortSignal),
  })));
});

it("sends the real two-second decoded duration to analysis", async () => {
  const referenceVideo = new File(["reference"], "reference.mp4", { type: "video/mp4" });
  const frames = Object.assign([
    { file: new File(["frame"], "frame.jpg", { type: "image/jpeg" }), atSec: 1.7 },
  ], { durationSec: 2 });
  vi.mocked(extractVideoFrames).mockResolvedValue(frames as Awaited<ReturnType<typeof extractVideoFrames>>);
  vi.mocked(analyzeScriptClient).mockResolvedValue({
    styleNotes: "warm studio",
    scenes: [{ id: "1", title: "opening", description: "product closeup", onScreenText: "", durationSec: 15 }],
  });

  render(<VideoRemake />);
  fireEvent.change(screen.getByLabelText("上传参考视频"), { target: { files: [referenceVideo] } });
  await screen.findByText("已抽取 1 帧画面用于分析。");
  fireEvent.click(screen.getByRole("button", { name: "开始分析视频" }));

  await waitFor(() => expect(analyzeScriptClient).toHaveBeenCalledWith(expect.objectContaining({
    videoDurationSec: 2,
  })));
});

it("selects an AI-generated model candidate with the clothing workflow", async () => {
  const referenceVideo = new File(["reference"], "reference.mp4", { type: "video/mp4" });
  const productImage = new File(["product"], "product.png", { type: "image/png" });
  const normalizedProduct = new File(["normalized-product"], "product.webp", { type: "image/webp" });
  vi.mocked(extractVideoFrames).mockResolvedValue(Object.assign([
    { file: new File(["frame"], "frame.jpg", { type: "image/jpeg" }), atSec: 4 },
  ], { durationSec: 5 }));
  vi.mocked(preprocessProductImage).mockResolvedValueOnce(normalizedProduct);
  vi.mocked(analyzeScriptClient).mockResolvedValue({
    styleNotes: "warm studio",
    scenes: [{ id: "1", title: "opening", description: "product closeup", onScreenText: "", durationSec: 15 }],
  });
  vi.mocked(submitClothingCandidatesClient).mockResolvedValueOnce([{
    planItemId: "model-1",
    status: "succeeded",
    progress: 100,
    resultUrl: "https://cdn.example/model-1.png",
    downloadToken: "signed-model-token",
  }]);

  render(<VideoRemake />);
  expect(screen.getByText("可选 · 所有分镜保持同一模特")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "AI 生成模特图" }));
  fireEvent.click(screen.getByRole("button", { name: "立即生成模特候选" }));
  fireEvent.click(await screen.findByRole("button", { name: /选择模特候选 model-1/ }));
  fireEvent.click(screen.getByRole("button", { name: "使用选中的模特" }));

  expect(screen.getByRole("img", { name: "已选模特图" })).toHaveAttribute(
    "src",
    "https://cdn.example/model-1.png",
  );

  fireEvent.change(screen.getByLabelText("上传参考视频"), { target: { files: [referenceVideo] } });
  await screen.findByText("已抽取 1 帧画面用于分析。");
  fireEvent.click(screen.getByRole("button", { name: "开始分析视频" }));
  await screen.findByRole("button", { name: "生成分镜" });
  fireEvent.change(screen.getByLabelText("上传商品图"), { target: { files: [productImage] } });
  await screen.findByText("已选择 1 张商品图。");
  fireEvent.click(screen.getByRole("button", { name: "生成分镜" }));

  await waitFor(() => expect(runSceneBatch).toHaveBeenCalledWith(expect.objectContaining({
    modelImage: expect.objectContaining({
      id: "model-1",
      source: "generated",
      downloadToken: "signed-model-token",
    }),
  })));
});

it("keeps picker-owned uploaded candidates alive when the selected model changes", async () => {
  const first = new File(["first"], "first.png", { type: "image/png" });
  const second = new File(["second"], "second.png", { type: "image/png" });
  const createObjectUrl = vi.spyOn(URL, "createObjectURL")
    .mockReturnValueOnce("blob:first-model")
    .mockReturnValueOnce("blob:second-model");
  const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

  render(<VideoRemake />);
  fireEvent.click(screen.getByRole("button", { name: "AI 生成模特图" }));
  fireEvent.click(screen.getByRole("button", { name: /^上传$/ }));
  fireEvent.change(screen.getByLabelText("上传模特候选图"), { target: { files: [first] } });
  await screen.findByRole("button", { name: "选择模特候选 first.png" });
  fireEvent.click(screen.getByRole("button", { name: "使用选中的模特" }));

  fireEvent.click(screen.getByRole("button", { name: "重新选择模特图" }));
  fireEvent.click(screen.getByRole("button", { name: /^上传$/ }));
  fireEvent.change(screen.getByLabelText("上传模特候选图"), { target: { files: [second] } });
  await screen.findByRole("button", { name: "选择模特候选 second.png" });
  fireEvent.click(screen.getByRole("button", { name: "使用选中的模特" }));
  await screen.findByRole("img", { name: "已选模特图" });

  expect(createObjectUrl).toHaveBeenCalledTimes(2);
  expect(revokeObjectUrl).not.toHaveBeenCalledWith("blob:first-model");
  fireEvent.click(screen.getByRole("button", { name: "重新选择模特图" }));
  const firstCandidate = screen.getByRole("button", { name: "选择模特候选 first.png" });
  expect(firstCandidate.querySelector("img")).toHaveAttribute("src", "blob:first-model");
});

it("clears the local model file input after reading a file", async () => {
  const modelImage = new File(["model"], "model.png", { type: "image/png" });
  const normalizedModel = new File(["normalized-model"], "model.webp", { type: "image/webp" });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:normalized-model");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.mocked(preprocessProductImage).mockResolvedValueOnce(normalizedModel);

  render(<VideoRemake />);
  const input = screen.getByLabelText("选择本地模特图文件") as HTMLInputElement;
  Object.defineProperty(input, "value", { configurable: true, writable: true, value: "C:\\fakepath\\model.png" });
  fireEvent.change(input, { target: { files: [modelImage] } });
  await screen.findByRole("img", { name: "已选模特图" });

  expect(input.value).toBe("");
});
