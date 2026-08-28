import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ClothingStudioApi } from "../lib/client-api";
import { ReferencePickerDialog } from "./reference-picker-dialog";

vi.mock("../lib/image-files", () => ({
  preprocessClothingImage: vi.fn(async (file: File) => file),
}));

const api = {
  submitCandidates: vi.fn(),
  status: vi.fn(),
} as unknown as Pick<ClothingStudioApi, "submitCandidates" | "status">;

afterEach(() => vi.clearAllMocks());

it("shows the complete model filter set and disables use until selection", () => {
  render(<ReferencePickerDialog kind="model" open candidates={[]} onClose={vi.fn()} onUse={vi.fn()} api={api} />);
  expect(screen.getByLabelText("性别")).toBeVisible();
  expect(screen.getByLabelText("年龄段")).toBeVisible();
  expect(screen.getByLabelText("肤色或地域外观")).toBeVisible();
  expect(screen.getByLabelText("体型")).toBeVisible();
  expect(screen.getByLabelText("发型")).toBeVisible();
  expect(screen.getByRole("button", { name: "使用选中的模特" })).toBeDisabled();
});

it("shows scene filters, uploaded and generated candidates together, and commits only on use", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const onUse = vi.fn();
  const generated = {
    id: "generated", kind: "scene" as const, source: "generated" as const,
    previewUrl: "/generated.png", downloadToken: "token",
  };
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:uploaded");
  render(<ReferencePickerDialog kind="scene" open candidates={[generated]} onClose={onClose} onUse={onUse} api={api} />);

  expect(screen.getByLabelText("风格感")).toBeVisible();
  expect(screen.getByLabelText("推荐场地")).toBeVisible();
  expect(screen.getByLabelText("光线")).toBeVisible();
  expect(screen.getByLabelText("季节")).toBeVisible();
  expect(screen.getByLabelText("场景其他要求")).toBeVisible();
  expect(screen.getByLabelText("生成张数")).toBeVisible();
  expect(screen.getByLabelText("最终图片比例")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "上传" }));
  await user.upload(screen.getByLabelText("上传场景候选图"), new File(["x"], "room.png", { type: "image/png" }));
  expect(screen.getAllByRole("button", { name: /选择场景候选/ })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "选择场景候选 room.png" }));
  expect(screen.getByRole("button", { name: "使用选中的场景" })).toBeEnabled();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledOnce();
  expect(onUse).not.toHaveBeenCalled();
});

it("keeps an individually failed AI candidate retryable", async () => {
  const user = userEvent.setup();
  vi.mocked(api.submitCandidates)
    .mockResolvedValueOnce([{ planItemId: "model-failed", status: "failed", progress: 0, error: "生成失败" }])
    .mockResolvedValueOnce([]);
  render(<ReferencePickerDialog kind="model" open candidates={[]} onClose={vi.fn()} onUse={vi.fn()} api={api} />);
  await user.click(screen.getByRole("button", { name: "立即生成模特候选" }));
  expect(await screen.findByText("生成失败")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "重试此候选" }));
  expect(api.submitCandidates).toHaveBeenCalledTimes(2);
});

it("opens a candidate in a large preview on double click and closes it with Escape", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  const generated = {
    id: "model-preview",
    kind: "model" as const,
    source: "generated" as const,
    previewUrl: "/model-preview.png",
    downloadToken: "token",
  };
  render(<ReferencePickerDialog kind="model" open candidates={[generated]} onClose={onClose} onUse={vi.fn()} api={api} />);

  await user.dblClick(screen.getByRole("button", { name: "选择模特候选 model-preview" }));
  expect(screen.getByRole("dialog", { name: "模特候选大图" })).toBeVisible();
  expect(screen.getByRole("img", { name: "模特候选大图" })).toHaveAttribute("src", "/model-preview.png");

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "模特候选大图" })).not.toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
