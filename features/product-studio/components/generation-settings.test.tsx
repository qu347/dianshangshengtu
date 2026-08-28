import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { defaultSettings } from "../test-fixtures";
import { GenerationSettingsForm } from "./generation-settings";

it("allows selecting 1 through 16 images", async () => {
  const onChange = vi.fn();
  render(<GenerationSettingsForm value={{ platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto", watermark: "", generateDimensionImage: true }} onChange={onChange} />);

  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "16");

  expect(onChange).toHaveBeenCalledWith({ imageCount: 16 });
});

it("maps Ozon to Russian and exposes native 3:4", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<GenerationSettingsForm value={defaultSettings} onChange={onChange} />);

  await user.selectOptions(screen.getByLabelText("平台"), "ozon");

  expect(onChange).toHaveBeenLastCalledWith({ platform: "ozon", language: "ru" });
  expect(screen.getByRole("option", { name: "3:4 竖版（1090×1443）" })).toBeInTheDocument();
});

it("disables fixed platform language and edits a 40-character watermark", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<GenerationSettingsForm value={defaultSettings} onChange={onChange} />);

  expect(screen.getByLabelText("语言")).toBeDisabled();
  expect(screen.getByRole("option", { name: "无营销文案" })).toBeInTheDocument();

  rerender(<GenerationSettingsForm value={{ ...defaultSettings, platform: "general" }} onChange={onChange} />);
  expect(screen.getByLabelText("语言")).toBeEnabled();
  fireEvent.change(screen.getByLabelText("文字水印"), { target: { value: "My Shop" } });
  expect(onChange).toHaveBeenLastCalledWith({ watermark: "My Shop" });
  expect(screen.getByLabelText("文字水印")).toHaveAttribute("maxLength", "40");
});
