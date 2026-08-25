import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { analysisWithTwoItems } from "../test-fixtures";
import { GenerationGrid } from "./generation-grid";

it("enables bulk download when at least one task succeeded", () => {
  render(<GenerationGrid items={analysisWithTwoItems.plan} tasks={[
    { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "https://cdn/1.png", downloadToken: "token" },
    { planItemId: "2", status: "failed", progress: 0, error: "失败" },
  ]} onRetry={vi.fn()} onContinuePolling={vi.fn()} onDownload={vi.fn()} onDownloadAll={vi.fn()} />);

  expect(screen.getByRole("button", { name: "下载全部" })).toBeEnabled();
});

it("renders one card per plan item and joins out-of-order tasks by plan item ID", () => {
  render(<GenerationGrid items={analysisWithTwoItems.plan} tasks={[
    { planItemId: "2", status: "failed", progress: 0, error: "第二张失败" },
    { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "https://cdn/1.png", downloadToken: "token" },
  ]} onRetry={vi.fn()} onContinuePolling={vi.fn()} onDownload={vi.fn()} onDownloadAll={vi.fn()} />);

  expect(screen.getAllByRole("article")).toHaveLength(2);
  expect(screen.getByRole("img", { name: "生成结果：白底主图" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("第二张失败");
});

it("disables bulk download without a successful signed result", () => {
  render(<GenerationGrid items={analysisWithTwoItems.plan} tasks={[
    { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "https://cdn/1.png" },
    { planItemId: "2", status: "failed", progress: 0, error: "失败" },
  ]} onRetry={vi.fn()} onContinuePolling={vi.fn()} onDownload={vi.fn()} onDownloadAll={vi.fn()} />);

  expect(screen.getByRole("button", { name: "下载全部" })).toBeDisabled();
});

it("warns that result links are temporary and should be downloaded in this session", () => {
  render(<GenerationGrid items={analysisWithTwoItems.plan} tasks={[
    { planItemId: "1", status: "succeeded", progress: 100, resultUrl: "https://cdn/1.png", downloadToken: "token" },
  ]} onRetry={vi.fn()} onContinuePolling={vi.fn()} onDownload={vi.fn()} onDownloadAll={vi.fn()} />);

  expect(screen.getByText("结果链接为临时链接，请在当前会话内及时下载保存。")).toBeInTheDocument();
});
