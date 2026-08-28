import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { ProductStudio } from "./product-studio";
import { analysisWithTwoItems } from "../test-fixtures";
import { downloadAllResults, downloadResult } from "../lib/downloads";
import type { PlanItem } from "../model";

vi.mock("../lib/image-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/image-files")>();
  return { ...actual, preprocessProductImage: vi.fn(async (file: File) => file) };
});

vi.mock("../lib/downloads", () => ({
  downloadAllResults: vi.fn(),
  downloadResult: vi.fn(),
}));

const unusedGenerationApi = {
  submit: vi.fn(async ({ item }: { item: PlanItem }) => ({ planItemId: item.id, providerJobId: `unused-${item.id}`, status: "running" as const, progress: 0 })),
  status: vi.fn(async (jobId: string, planItemId: string) => ({ planItemId, providerJobId: jobId, status: "succeeded" as const, progress: 100, resultUrl: "https://cdn.example/unused.png", downloadToken: "unused-token" })),
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function fillRequiredDimension() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("尺寸名称 1"), "杯高");
  await user.type(screen.getByLabelText("尺寸数值 1"), "12");
}

async function renderSuccessfulStudio() {
  const oneItemAnalysis = { ...analysisWithTwoItems, plan: [analysisWithTwoItems.plan[0]] };
  const submit = vi.fn(async ({ item }: { item: PlanItem }) => ({
    planItemId: item.id,
    providerJobId: "job-1",
    status: "running" as const,
    progress: 0,
  }));
  const status = vi.fn(async (jobId: string, planItemId: string) => ({
    planItemId,
    providerJobId: jobId,
    status: "succeeded" as const,
    progress: 100,
    resultUrl: "https://cdn.example/job-1.png",
    downloadToken: "token-job-1",
  }));
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(oneItemAnalysis), submit, status }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "1");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  await screen.findByRole("img", { name: "生成结果：白底主图" });
}

it("renders the product studio as a configuration and creation workspace", () => {
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(analysisWithTwoItems), ...unusedGenerationApi }} />);

  expect(screen.getByRole("heading", { name: "商品视觉工作台" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "项目配置" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "创作工作台" })).toBeInTheDocument();
});

it("defaults dimension-image generation on and preserves entered dimensions when toggled", async () => {
  const user = userEvent.setup();
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(analysisWithTwoItems), ...unusedGenerationApi }} />);

  const toggle = screen.getByRole("checkbox", { name: "生成尺寸标注图" });
  expect(toggle).toBeChecked();
  await user.type(screen.getByLabelText("尺寸名称 1"), "杯高");
  await user.type(screen.getByLabelText("尺寸数值 1"), "12");

  await user.click(toggle);
  expect(screen.queryByLabelText("尺寸名称 1")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("尺寸数值 1")).not.toBeInTheDocument();

  await user.click(toggle);
  expect(screen.getByLabelText("尺寸名称 1")).toHaveValue("杯高");
  expect(screen.getByLabelText("尺寸数值 1")).toHaveValue(12);
});

it("analyzes two ordinary product images without dimension data when the option is off", async () => {
  const ordinaryAnalysis = {
    ...analysisWithTwoItems,
    plan: [
      analysisWithTwoItems.plan[0],
      {
        ...analysisWithTwoItems.plan[1],
        title: "商品细节图",
        objective: "展示商品外观细节",
        scene: "简洁的商品展示场景",
        prompt: "生成突出商品外观细节的电商展示图。",
        annotations: [],
      },
    ],
  };
  const analyze = vi.fn().mockResolvedValue(ordinaryAnalysis);
  const user = userEvent.setup();
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await user.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await user.selectOptions(screen.getByLabelText("生成数量"), "2");
  await user.click(screen.getByRole("checkbox", { name: "生成尺寸标注图" }));
  await user.click(screen.getByRole("button", { name: "开始分析产品" }));

  await waitFor(() => expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
    dimensions: [],
    settings: expect.objectContaining({ generateDimensionImage: false }),
  })));
});

it("uploads a product and shows the analysis", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await userEvent.upload(
    screen.getByLabelText("上传产品图"),
    new File(["x"], "cup.png", { type: "image/png" }),
  );
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));

  expect(await screen.findByText(analysisWithTwoItems.visualDirection)).toBeInTheDocument();
  expect(screen.getByText("银色金属杯身")).toBeInTheDocument();
});

it("shows localized dimension annotations in the editable two-image plan", async () => {
  const analysis = {
    ...analysisWithTwoItems,
    plan: [
      analysisWithTwoItems.plan[0],
      {
        ...analysisWithTwoItems.plan[1],
        annotations: [{ label: "Высота чашки", displayValue: "12 см" }],
      },
    ],
  };
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(analysis), ...unusedGenerationApi }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));

  expect(await screen.findByLabelText("第 1 张中文生图提示词")).toBeEnabled();
  expect(screen.getByLabelText("第 2 张中文生图提示词")).toBeEnabled();
  expect(screen.getByText("尺寸标注")).toBeInTheDocument();
  expect(screen.getByText("Высота чашки")).toBeInTheDocument();
  expect(screen.getByText("12 см")).toBeInTheDocument();
});

it("sends product dimensions and watermark to analysis", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  const user = userEvent.setup();
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await user.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await user.clear(screen.getByLabelText("尺寸名称 1"));
  await user.type(screen.getByLabelText("尺寸名称 1"), "杯高");
  await user.clear(screen.getByLabelText("尺寸数值 1"));
  await user.type(screen.getByLabelText("尺寸数值 1"), "12");
  await user.type(screen.getByLabelText("文字水印"), "My Shop");
  await user.selectOptions(screen.getByLabelText("生成数量"), "2");
  await user.click(screen.getByRole("button", { name: "开始分析产品" }));

  await waitFor(() => expect(analyze).toHaveBeenCalledWith(expect.objectContaining({
    dimensions: [expect.objectContaining({ label: "杯高", value: 12, unit: "cm" })],
    settings: expect.objectContaining({ watermark: "My Shop" }),
  })));
});

it("shows dimension validation errors without calling analysis", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));

  expect(analyze).not.toHaveBeenCalled();
  expect(screen.getByText("请填写尺寸名称")).toBeInTheDocument();
  expect(screen.getByText("尺寸数值必须大于 0")).toBeInTheDocument();
});

it("allows one-image analysis after deleting the final dimension", async () => {
  const oneItemAnalysis = { ...analysisWithTwoItems, plan: [analysisWithTwoItems.plan[0]] };
  const analyze = vi.fn().mockResolvedValue(oneItemAnalysis);
  const user = userEvent.setup();
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await user.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await user.selectOptions(screen.getByLabelText("生成数量"), "1");
  await user.click(screen.getByRole("button", { name: "删除尺寸项 1" }));
  await user.click(screen.getByRole("button", { name: "开始分析产品" }));

  await waitFor(() => expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ dimensions: [] })));
});

it("clears the plan and asks for re-analysis when generation count changes", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  const user = userEvent.setup();
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await user.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await fillRequiredDimension();
  await user.click(screen.getByRole("button", { name: "开始分析产品" }));
  expect(await screen.findByLabelText("第 1 张中文生图提示词")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("生成数量"), "3");

  expect(screen.queryByLabelText("第 1 张中文生图提示词")).not.toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("关键参数已变化，请重新分析产品");
});

it("keeps successful images and retries only the failed plan item", async () => {
  let submission = 0;
  const submit = vi.fn(async ({ item }: { item: PlanItem }) => ({ planItemId: item.id, providerJobId: `job-${++submission}`, status: "running" as const, progress: 0 }));
  const status = vi.fn(async (jobId: string, planItemId: string) => {
    if (jobId === "job-2") return { planItemId, providerJobId: jobId, status: "failed" as const, progress: 0, error: "上游生成失败" };
    return { planItemId, providerJobId: jobId, status: "succeeded" as const, progress: 100, resultUrl: `https://cdn.example/${jobId}.png`, downloadToken: `token-${jobId}` };
  });
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(analysisWithTwoItems), submit, status }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  await userEvent.click(await screen.findByRole("button", { name: "重试此图" }));

  expect(await screen.findAllByRole("img", { name: /生成结果/ })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "下载全部" })).toBeEnabled();
  expect(submit).toHaveBeenCalledTimes(3);
  expect(submit).toHaveBeenNthCalledWith(2, expect.objectContaining({
    item: analysisWithTwoItems.plan[1],
    baseImageToken: "token-job-1",
  }));
  expect(submit).toHaveBeenNthCalledWith(3, expect.objectContaining({
    item: analysisWithTwoItems.plan[1],
    baseImageToken: "token-job-1",
  }));
});

it("retries an ordinary image two without depending on image one", async () => {
  const ordinarySecond = {
    ...analysisWithTwoItems.plan[1],
    title: "商品细节图",
    objective: "展示商品外观细节",
    copy: "",
    scene: "自然光商品展示场景",
    prompt: "生成突出商品外观细节的普通展示图。",
    annotations: [],
  };
  const ordinaryAnalysis = {
    ...analysisWithTwoItems,
    plan: [analysisWithTwoItems.plan[0], ordinarySecond],
  };
  let secondAttempt = 0;
  const submit = vi.fn(async ({ item }: { item: PlanItem; baseImageToken?: string }) => {
    if (item.id === "1") {
      return {
        planItemId: item.id,
        status: "succeeded" as const,
        progress: 100,
        resultUrl: "https://cdn.example/1.png",
        downloadToken: "token-1",
      };
    }
    secondAttempt += 1;
    return secondAttempt === 1
      ? { planItemId: item.id, status: "failed" as const, progress: 0, error: "上游生成失败" }
      : {
        planItemId: item.id,
        status: "succeeded" as const,
        progress: 100,
        resultUrl: "https://cdn.example/2.png",
        downloadToken: "token-2",
      };
  });
  render(<ProductStudio api={{
    analyze: vi.fn().mockResolvedValue(ordinaryAnalysis),
    submit,
    status: vi.fn(),
  }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await userEvent.click(screen.getByRole("checkbox", { name: "生成尺寸标注图" }));
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  await userEvent.click(await screen.findByRole("button", { name: "重试此图" }));

  await screen.findByRole("img", { name: "生成结果：商品细节图" });
  const secondCalls = submit.mock.calls
    .map(([call]) => call)
    .filter((call) => call.item.id === "2");
  expect(secondCalls).toHaveLength(2);
  expect(secondCalls.every((call) => !("baseImageToken" in call))).toBe(true);
});

it("continues a timed-out job without submitting it again", async () => {
  let statusCall = 0;
  const submit = vi.fn(async ({ item }: { item: PlanItem }) => ({ planItemId: item.id, providerJobId: `job-${item.id}`, status: "running" as const, progress: 0 }));
  const status = vi.fn(async (jobId: string, planItemId: string) => {
    statusCall += 1;
    if (statusCall === 1) return { planItemId, providerJobId: jobId, status: "timed_out" as const, progress: 50 };
    return { planItemId, providerJobId: jobId, status: "succeeded" as const, progress: 100, resultUrl: `https://cdn.example/${jobId}.png`, downloadToken: `token-${jobId}` };
  });
  const oneItemAnalysis = { ...analysisWithTwoItems, plan: [analysisWithTwoItems.plan[0]] };
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(oneItemAnalysis), submit, status }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "1");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  await userEvent.click(await screen.findByRole("button", { name: "继续查询" }));

  expect(await screen.findByRole("img", { name: "生成结果：白底主图" })).toBeInTheDocument();
  expect(submit).toHaveBeenCalledOnce();
  expect(status).toHaveBeenNthCalledWith(2, "job-1", "1");
});

it("disables key inputs and ignores an analysis result invalidated by newer input", async () => {
  let resolveAnalysis!: (analysis: typeof analysisWithTwoItems) => void;
  const analysis = new Promise<typeof analysisWithTwoItems>((resolve) => { resolveAnalysis = resolve; });
  const analyze = vi.fn(() => analysis);
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await userEvent.upload(
    screen.getByLabelText("上传产品图"),
    new File(["x"], "cup.png", { type: "image/png" }),
  );
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));

  expect(screen.getByLabelText("上传产品图")).toBeDisabled();
  expect(screen.getByLabelText("产品名称")).toBeDisabled();
  expect(screen.getByLabelText("尺寸名称 1")).toBeDisabled();
  expect(screen.getByLabelText("补充要求")).toBeDisabled();
  expect(screen.getByLabelText("平台")).toBeDisabled();
  expect(screen.getByRole("button", { name: "开始分析产品" })).toBeDisabled();

  fireEvent.change(screen.getByLabelText("产品名称"), { target: { value: "更新后的产品" } });
  await act(async () => { resolveAnalysis(analysisWithTwoItems); });

  expect(screen.queryByText(analysisWithTwoItems.visualDirection)).not.toBeInTheDocument();
  expect(screen.getByLabelText("产品名称")).toHaveValue("更新后的产品");
});

it("uses one page-wide generation lock for rapid retries", async () => {
  let resolveRetry!: (task: {
    planItemId: string;
    providerJobId: string;
    status: "running";
    progress: number;
  }) => void;
  const retrySubmission = new Promise<{
    planItemId: string;
    providerJobId: string;
    status: "running";
    progress: number;
  }>((resolve) => { resolveRetry = resolve; });
  let submitCall = 0;
  const submit = vi.fn(async ({ item }: { item: PlanItem }) => {
    submitCall += 1;
    if (submitCall === 3) return retrySubmission;
    return {
      planItemId: item.id,
      providerJobId: `job-${submitCall}`,
      status: "running" as const,
      progress: 0,
    };
  });
  const status = vi.fn(async (jobId: string, planItemId: string) => (
    jobId === "job-2"
      ? { planItemId, providerJobId: jobId, status: "failed" as const, progress: 0, error: "上游生成失败" }
      : { planItemId, providerJobId: jobId, status: "succeeded" as const, progress: 100, resultUrl: `https://cdn.example/${jobId}.png`, downloadToken: `token-${jobId}` }
  ));
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(analysisWithTwoItems), submit, status }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  const retryButton = await screen.findByRole("button", { name: "重试此图" });

  fireEvent.click(retryButton);
  fireEvent.click(retryButton);
  expect(await screen.findByText("正在重新提交…")).toBeInTheDocument();

  expect(submit).toHaveBeenCalledTimes(3);
  expect(screen.queryByRole("button", { name: "重试此图" })).not.toBeInTheDocument();

  await act(async () => {
    resolveRetry({ planItemId: "2", providerJobId: "job-3", status: "running", progress: 0 });
  });
  await waitFor(() => expect(status).toHaveBeenCalledWith("job-3", "2"));
  expect(submit).toHaveBeenCalledTimes(3);
});

it("offers continuation after a submitted job status lookup errors", async () => {
  const oneItemAnalysis = { ...analysisWithTwoItems, plan: [analysisWithTwoItems.plan[0]] };
  const submit = vi.fn(async ({ item }: { item: PlanItem }) => ({
    planItemId: item.id,
    providerJobId: "job-1",
    status: "running" as const,
    progress: 0,
  }));
  const status = vi.fn()
    .mockRejectedValueOnce(new Error("provider lookup details"))
    .mockResolvedValueOnce({
      planItemId: "1",
      providerJobId: "job-1",
      status: "succeeded" as const,
      progress: 100,
      resultUrl: "https://cdn.example/job-1.png",
      downloadToken: "token-job-1",
    });
  render(<ProductStudio api={{ analyze: vi.fn().mockResolvedValue(oneItemAnalysis), submit, status }} />);

  await userEvent.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "1");
  await fillRequiredDimension();
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  const continueButton = await screen.findByRole("button", { name: "继续查询" });

  expect(screen.getByText("查询生图任务失败，可继续查询")).toBeInTheDocument();
  await userEvent.click(continueButton);

  expect(await screen.findByRole("img", { name: "生成结果：白底主图" })).toBeInTheDocument();
  expect(submit).toHaveBeenCalledOnce();
  expect(status).toHaveBeenCalledTimes(2);
});

it("guards all download controls while an individual download is active", async () => {
  let resolveDownload!: () => void;
  vi.mocked(downloadResult).mockReturnValue(new Promise<void>((resolve) => { resolveDownload = resolve; }));
  await renderSuccessfulStudio();
  const downloadButton = screen.getByRole("button", { name: "下载" });
  const downloadAllButton = screen.getByRole("button", { name: "下载全部" });

  fireEvent.click(downloadButton);
  fireEvent.click(downloadButton);
  fireEvent.click(downloadAllButton);

  expect(downloadResult).toHaveBeenCalledOnce();
  expect(downloadAllResults).not.toHaveBeenCalled();
  expect(downloadButton).toBeDisabled();
  expect(downloadAllButton).toBeDisabled();

  await act(async () => { resolveDownload(); });
});

it("shows an individual download failure", async () => {
  vi.mocked(downloadResult).mockRejectedValueOnce(new Error("图片下载失败，请重试"));
  await renderSuccessfulStudio();

  await userEvent.click(screen.getByRole("button", { name: "下载" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("图片下载失败，请重试");
});

it("shows a ZIP download failure", async () => {
  vi.mocked(downloadAllResults).mockRejectedValueOnce(new Error("结果打包下载失败，请重试"));
  await renderSuccessfulStudio();

  await userEvent.click(screen.getByRole("button", { name: "下载全部" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("结果打包下载失败，请重试");
});
