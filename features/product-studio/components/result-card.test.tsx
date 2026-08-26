import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, vi } from "vitest";
import { makePlanItems } from "../test-fixtures";
import { ResultCard } from "./result-card";

const item = makePlanItems(1)[0];
const handlers = { onRetry: vi.fn(), onContinuePolling: vi.fn(), onDownload: vi.fn() };

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn();
  HTMLDialogElement.prototype.close ??= vi.fn();
});

it.each([
  ["queued", "等待生成"],
  ["submitting", "正在提交"],
  ["running", "生成中"],
] as const)("shows %s task status", (status, label) => {
  render(<ResultCard item={item} task={{ planItemId: item.id, status, progress: 40 }} {...handlers} />);

  expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute("value", "40");
});

it("distinguishes a retry submission from the first submission", () => {
  render(<ResultCard item={item} task={{ planItemId: item.id, status: "submitting", progress: 0 }} {...handlers} retrying />);

  expect(screen.getByText("正在重新提交…")).toBeInTheDocument();
});

it("shows the result and download after success", () => {
  render(<ResultCard item={item} task={{ planItemId: item.id, status: "succeeded", progress: 100, resultUrl: "https://cdn.example/result.png", downloadToken: "token" }} {...handlers} />);

  expect(screen.getByRole("img", { name: "生成结果：白底主图" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看大图" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "下载" })).toBeEnabled();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("closes the result dialog and returns focus to its trigger", async () => {
  const user = userEvent.setup();
  render(<ResultCard item={item} task={{ planItemId: item.id, status: "succeeded", progress: 100, resultUrl: "https://cdn.example/result.png", downloadToken: "token" }} {...handlers} />);
  const trigger = screen.getByRole("button", { name: "查看大图" });

  await user.click(trigger);
  expect(screen.getByRole("dialog", { name: "生成结果：白底主图" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "关闭大图" }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("offers retry for failure and continuing lookup for timeout", () => {
  const { rerender } = render(<ResultCard item={item} task={{ planItemId: item.id, status: "failed", progress: 0, error: "积分不足" }} {...handlers} />);
  expect(screen.getByRole("alert")).toHaveTextContent("积分不足");
  expect(screen.getByRole("button", { name: "重试此图" })).toBeEnabled();

  rerender(<ResultCard item={item} task={{ planItemId: item.id, providerJobId: "job-1", status: "timed_out", progress: 50 }} {...handlers} />);
  expect(screen.getByRole("button", { name: "继续查询" })).toBeEnabled();
  expect(screen.queryByText("生成失败")).not.toBeInTheDocument();
});

it("explains why retry is unavailable while another generation operation is busy", () => {
  render(
    <ResultCard
      item={item}
      task={{ planItemId: item.id, status: "failed", progress: 0, error: "网络失败" }}
      {...handlers}
      busy
    />,
  );

  expect(screen.getByRole("button", { name: "重试此图" })).toBeDisabled();
  expect(screen.getByText("当前批次生成中，完成后可重试")).toBeInTheDocument();
});
