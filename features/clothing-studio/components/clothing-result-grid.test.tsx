import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { makeClothingAnalysis } from "../test-fixtures";
import { ClothingResultGrid } from "./clothing-result-grid";

it("shows retry, continue-query, downloads, and several-minute guidance", () => {
  const items = makeClothingAnalysis(3).plan;
  render(<ClothingResultGrid
    items={items}
    tasks={[
      { planItemId: "1", status: "failed", progress: 0, error: "生成失败" },
      { planItemId: "2", providerJobId: "job-2", status: "timed_out", progress: 60 },
      { planItemId: "3", status: "succeeded", progress: 100, resultUrl: "/three.png", downloadToken: "three" },
    ]}
    onRetry={vi.fn()}
    onContinuePolling={vi.fn()}
    onDownload={vi.fn()}
    onDownloadAll={vi.fn()}
  />);
  expect(screen.getByRole("button", { name: "重试第 1 张" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "继续查询第 2 张" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "下载第 3 张" })).toBeEnabled();
  expect(screen.getByText(/生成可能需要几分钟/)).toBeVisible();
  expect(screen.getByRole("img", { name: items[2].title })).toHaveClass("object-contain");
});
it("disables recovered retries but keeps polling and download available", () => {
  const items = makeClothingAnalysis(3).plan;
  render(<ClothingResultGrid
    items={items}
    tasks={[
      { planItemId: "1", status: "failed", progress: 0, error: "生成失败" },
      { planItemId: "2", providerJobId: "job-2", status: "timed_out", progress: 60 },
      { planItemId: "3", status: "succeeded", progress: 100, resultUrl: "/three.png", downloadToken: "three" },
    ]}
    recovered
    onRetry={vi.fn()}
    onContinuePolling={vi.fn()}
    onDownload={vi.fn()}
    onDownloadAll={vi.fn()}
  />);
  expect(screen.getByRole("button", { name: "重试第 1 张" })).toBeDisabled();
  expect(screen.getByText("重新上传服装和模特后可重试")).toBeVisible();
  expect(screen.getByRole("button", { name: "继续查询第 2 张" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "下载第 3 张" })).toBeEnabled();
});
it("restores focus after closing the large-image dialog", async () => {
  const user = userEvent.setup();
  const item = makeClothingAnalysis(1).plan[0];
  render(<ClothingResultGrid
    items={[item]}
    tasks={[{ planItemId: "1", status: "succeeded", progress: 100, resultUrl: "/one.png", downloadToken: "one" }]}
    onRetry={vi.fn()}
    onContinuePolling={vi.fn()}
    onDownload={vi.fn()}
    onDownloadAll={vi.fn()}
  />);
  const open = screen.getByRole("button", { name: "查看第 1 张大图" });
  await user.click(open);
  await user.click(screen.getByRole("button", { name: "关闭大图" }));
  expect(open).toHaveFocus();
});
