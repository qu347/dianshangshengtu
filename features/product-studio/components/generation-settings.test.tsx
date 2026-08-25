import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { GenerationSettingsForm } from "./generation-settings";

it("allows selecting 1 through 16 images", async () => {
  const onChange = vi.fn();
  render(<GenerationSettingsForm value={{ platform: "taobao", language: "zh-CN", aspectRatio: "1024x1536", imageCount: 4, quality: "auto" }} onChange={onChange} />);

  await userEvent.selectOptions(screen.getByLabelText("生成数量"), "16");

  expect(onChange).toHaveBeenCalledWith({ imageCount: 16 });
});
