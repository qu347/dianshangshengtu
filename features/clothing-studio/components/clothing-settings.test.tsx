import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { defaultClothingSettings } from "../test-fixtures";
import { ClothingSettingsForm } from "./clothing-settings";

it("exposes exactly 1 through 16 results and all quality values", () => {
  render(<ClothingSettingsForm value={defaultClothingSettings} onChange={vi.fn()} />);
  const count = screen.getByLabelText("生成数量") as HTMLSelectElement;
  expect(Array.from(count.options).map((option) => option.value)).toEqual(
    Array.from({ length: 16 }, (_, index) => String(index + 1)),
  );
  const quality = screen.getByLabelText("图片质量") as HTMLSelectElement;
  expect(Array.from(quality.options).map((option) => option.value)).toEqual(["auto", "low", "medium", "high"]);
});

it("maps Amazon to English and Ozon to Russian", async () => {
  const onChange = vi.fn();
  render(<ClothingSettingsForm value={defaultClothingSettings} onChange={onChange} />);
  await userEvent.selectOptions(screen.getByLabelText("平台"), "amazon");
  expect(onChange).toHaveBeenLastCalledWith({ platform: "amazon", language: "en" });
  await userEvent.selectOptions(screen.getByLabelText("平台"), "ozon");
  expect(onChange).toHaveBeenLastCalledWith({ platform: "ozon", language: "ru" });
  expect(screen.queryByText("产品尺寸")).not.toBeInTheDocument();
});

