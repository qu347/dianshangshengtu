import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { defaultClothingSettings, makeClothingAnalysis } from "../test-fixtures";
import { ClothingPlanEditor } from "./clothing-plan-editor";

it("locks image-one type and disables confirmation when an editable Chinese prompt is empty", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const analysis = makeClothingAnalysis(2);
  const { rerender } = render(<ClothingPlanEditor
    analysis={analysis}
    settings={defaultClothingSettings}
    onChange={onChange}
    onReplan={vi.fn()}
    onConfirm={vi.fn()}
  />);
  expect(screen.getByLabelText("第 1 张类型")).toBeDisabled();
  expect(screen.getByLabelText("第 1 张类型")).toHaveDisplayValue("白底立体主图");
  expect(screen.getByRole("button", { name: "确认规划并生成" })).toBeEnabled();

  await user.clear(screen.getByLabelText("第 2 张中文生图提示词"));
  const changed = onChange.mock.calls.at(-1)?.[0];
  rerender(<ClothingPlanEditor
    analysis={changed}
    settings={defaultClothingSettings}
    onChange={onChange}
    onReplan={vi.fn()}
    onConfirm={vi.fn()}
  />);
  expect(screen.getByRole("button", { name: "确认规划并生成" })).toBeDisabled();
});
