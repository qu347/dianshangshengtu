import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ProductStudio } from "./product-studio";
import { analysisWithTwoItems } from "../test-fixtures";
import type { PlanItem } from "../model";

vi.mock("../lib/image-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/image-files")>();
  return { ...actual, preprocessProductImage: vi.fn(async (file: File) => file) };
});

const unusedGenerationApi = {
  submit: vi.fn(async ({ item }: { item: PlanItem }) => ({ planItemId: item.id, providerJobId: `unused-${item.id}`, status: "running" as const, progress: 0 })),
  status: vi.fn(async (jobId: string, planItemId: string) => ({ planItemId, providerJobId: jobId, status: "succeeded" as const, progress: 100, resultUrl: "https://cdn.example/unused.png", downloadToken: "unused-token" })),
};

it("uploads a product and shows the analysis", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await userEvent.upload(
    screen.getByLabelText("上传产品图"),
    new File(["x"], "cup.png", { type: "image/png" }),
  );
  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "2");
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));

  expect(await screen.findByText(analysisWithTwoItems.visualDirection)).toBeInTheDocument();
  expect(screen.getByText("银色金属杯身")).toBeInTheDocument();
});

it("clears the plan and asks for re-analysis when generation count changes", async () => {
  const analyze = vi.fn().mockResolvedValue(analysisWithTwoItems);
  const user = userEvent.setup();
  render(<ProductStudio api={{ analyze, ...unusedGenerationApi }} />);

  await user.upload(screen.getByLabelText("上传产品图"), new File(["x"], "cup.png", { type: "image/png" }));
  await user.click(screen.getByRole("button", { name: "开始分析产品" }));
  expect(await screen.findByLabelText("第 1 张生图提示词")).toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("生成数量"), "3");

  expect(screen.queryByLabelText("第 1 张生图提示词")).not.toBeInTheDocument();
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
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  await userEvent.click(await screen.findByRole("button", { name: "重试此图" }));

  expect(await screen.findAllByRole("img", { name: /生成结果/ })).toHaveLength(2);
  expect(screen.getByRole("button", { name: "下载全部" })).toBeEnabled();
  expect(submit).toHaveBeenCalledTimes(3);
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
  await userEvent.click(screen.getByRole("button", { name: "开始分析产品" }));
  await userEvent.click(await screen.findByRole("button", { name: "确认规划并生成" }));
  await userEvent.click(await screen.findByRole("button", { name: "继续查询" }));

  expect(await screen.findByRole("img", { name: "生成结果：白底主图" })).toBeInTheDocument();
  expect(submit).toHaveBeenCalledOnce();
  expect(status).toHaveBeenNthCalledWith(2, "job-1", "1");
});
