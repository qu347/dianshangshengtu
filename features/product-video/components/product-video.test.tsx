import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ProductVideo } from "./product-video";
import type { IntroScript, VideoIntroSettings } from "../model";

vi.mock("@/features/product-studio/lib/image-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/product-studio/lib/image-files")>();
  return { ...actual, preprocessProductImage: vi.fn(async (file: File) => file) };
});

const script: IntroScript = {
  styleNotes: "黑金质感背景，节奏干脆，大字卖点叠层",
  shots: [{ id: "1", title: "开镜特写", description: "黑金背景中商品居中特写，缓慢推进", onScreenText: "96小时超长续航", durationSec: 10 }],
};

function makeApi() {
  return {
    analyze: vi.fn(async (input: { imageFiles: File[]; productName: string; requirements: string; settings: VideoIntroSettings }) => script),
    submit: vi.fn(async () => ({ shotId: "1", providerJobId: "job-1", status: "running" as const, progress: 0 })),
    status: vi.fn(async (jobToken: string, shotId: string) => ({
      shotId,
      providerJobId: jobToken,
      status: "succeeded" as const,
      progress: 100,
      resultUrl: "https://cdn.example/clip.mp4",
      downloadToken: "token-1",
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("walks upload, analyze, confirm, and a successful generation", async () => {
  const user = userEvent.setup();
  const api = makeApi();
  render(<ProductVideo api={api} />);

  await user.upload(screen.getByLabelText("上传商品图"), [
    new File(["a"], "front.png", { type: "image/png" }),
    new File(["b"], "side.png", { type: "image/png" }),
  ]);
  expect(screen.getByText("已选择 2 张商品图。")).toBeInTheDocument();

  await user.type(screen.getByLabelText("商品名称"), "无线蓝牙耳机");
  await user.type(screen.getByLabelText("卖点要求"), "突出 96 小时超长续航");
  await user.selectOptions(screen.getByLabelText("视频清晰度"), "720p");
  await user.click(screen.getByRole("button", { name: "开始生成脚本" }));

  expect(await screen.findByLabelText("风格摘要")).toHaveTextContent("黑金质感背景");
  expect(api.analyze).toHaveBeenCalledWith(expect.objectContaining({
    productName: "无线蓝牙耳机",
    requirements: "突出 96 小时超长续航",
    settings: expect.objectContaining({ durationSec: 10, aspectRatio: "9:16", resolution: "720p" }),
  }));
  expect(api.analyze.mock.calls[0][0].imageFiles.map((file) => file.name)).toEqual(["front.png", "side.png"]);

  await user.click(screen.getByRole("button", { name: "确认脚本并生成视频" }));

  expect(await screen.findByLabelText("第 1 镜视频预览")).toBeInTheDocument();
  expect(api.submit).toHaveBeenCalledWith(expect.objectContaining({
    shot: expect.objectContaining({ id: "1", onScreenText: "96小时超长续航" }),
    settings: expect.objectContaining({ resolution: "720p" }),
  }));
  expect(api.status).toHaveBeenCalledWith("job-1", "1", expect.any(AbortSignal));
  expect(screen.getByRole("button", { name: "下载全部" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "下载合并视频" })).not.toBeInTheDocument();
});

it("blocks analysis without images and surfaces analyze failures", async () => {
  const user = userEvent.setup();
  const api = makeApi();
  api.analyze.mockRejectedValueOnce(new Error("分镜脚本格式异常，请重新分析"));
  render(<ProductVideo api={api} />);

  expect(screen.getByRole("button", { name: "开始生成脚本" })).toBeDisabled();

  await user.upload(screen.getByLabelText("上传商品图"), [new File(["a"], "front.png", { type: "image/png" })]);
  await user.click(screen.getByRole("button", { name: "开始生成脚本" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("分镜脚本格式异常，请重新分析");
});

it("retries only the failed shot while retaining other completed previews", async () => {
  const user = userEvent.setup();
  const multiShotScript: IntroScript = {
    styleNotes: "黑金质感背景",
    shots: ["1", "2", "3"].map((id) => ({ id, title: `第 ${id} 镜`, description: "商品特写", onScreenText: "卖点", durationSec: 5 })),
  };
  const api = {
    analyze: vi.fn(async () => multiShotScript),
    submit: vi.fn(async ({ shot }: { shot: { id: string } }) => (
      shot.id === "3"
        ? { shotId: "3", status: "failed" as const, progress: 0, error: "任务失败" }
        : { shotId: shot.id, status: "succeeded" as const, progress: 100, resultUrl: `https://cdn.example/${shot.id}.mp4`, downloadToken: `token-${shot.id}` }
    )),
    status: vi.fn(),
  };
  render(<ProductVideo api={api} />);

  await user.upload(screen.getByLabelText("上传商品图"), new File(["a"], "front.png", { type: "image/png" }));
  fireEvent.change(screen.getByLabelText("视频总时长"), { target: { value: "15" } });
  await user.click(screen.getByRole("button", { name: "开始生成脚本" }));
  await user.click(await screen.findByRole("button", { name: "确认脚本并生成视频" }));

  expect(await screen.findByLabelText("第 1 镜视频预览")).toBeInTheDocument();
  expect(screen.getByLabelText("第 2 镜视频预览")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重试此镜头" }));

  expect(await screen.findByLabelText("第 1 镜视频预览")).toBeInTheDocument();
  expect(screen.getByLabelText("第 2 镜视频预览")).toBeInTheDocument();
  expect(api.submit.mock.calls.slice(-1)[0][0].shot.id).toBe("3");
});
