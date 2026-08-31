import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { VideoRemake } from "./video-remake";
import { analyzeScriptClient } from "../lib/client";
import { runSceneBatch } from "../lib/scene-runner";
import { extractVideoFrames } from "../lib/frames";
import { preprocessProductImage } from "@/features/product-studio/lib/image-files";

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
vi.mock("./script-editor", () => ({
  ScriptEditor: ({ onConfirm }: { onConfirm: () => void }) => <button type="button" onClick={onConfirm}>生成分镜</button>,
}));

it("passes the selected normalized model image to scene generation", async () => {
  const referenceVideo = new File(["reference"], "reference.mp4", { type: "video/mp4" });
  const productImage = new File(["product"], "product.png", { type: "image/png" });
  const modelImage = new File(["model"], "model.png", { type: "image/png" });
  const normalizedProduct = new File(["normalized-product"], "product.webp", { type: "image/webp" });
  const normalizedModel = new File(["normalized-model"], "model.webp", { type: "image/webp" });

  vi.mocked(extractVideoFrames).mockResolvedValue([{ file: new File(["frame"], "frame.jpg", { type: "image/jpeg" }), atSec: 4 }]);
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
  fireEvent.change(screen.getByLabelText("上传模特图"), { target: { files: [modelImage] } });
  await screen.findByText("已选择模特图。");
  fireEvent.click(screen.getByRole("button", { name: "生成分镜" }));

  await waitFor(() => expect(runSceneBatch).toHaveBeenCalledWith(expect.objectContaining({
    modelImage: normalizedModel,
  })));
});
