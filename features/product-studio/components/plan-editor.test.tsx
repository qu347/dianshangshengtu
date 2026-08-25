import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import { PlanEditor } from "./plan-editor";
import { analysisWithTwoItems } from "../test-fixtures";

it("edits one prompt without changing the remaining plan items", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  function Harness() {
    const [analysis, setAnalysis] = useState(analysisWithTwoItems);
    return <PlanEditor analysis={analysis} onChange={(nextAnalysis) => { onChange(nextAnalysis); setAnalysis(nextAnalysis); }} onReplan={vi.fn()} onConfirm={vi.fn()} />;
  }
  render(<Harness />);

  const prompts = screen.getAllByLabelText(/生图提示词/);
  await user.clear(prompts[0]);
  await user.type(prompts[0], "新的白底主图提示词");

  const latest = onChange.mock.calls.at(-1)?.[0];
  expect(latest).not.toBe(analysisWithTwoItems);
  expect(latest.plan[0].prompt).toBe("新的白底主图提示词");
  expect(latest.plan[1]).toEqual(analysisWithTwoItems.plan[1]);
});

it("renders editable fields with the numbered prompt labels", () => {
  render(<PlanEditor analysis={analysisWithTwoItems} onChange={vi.fn()} onReplan={vi.fn()} onConfirm={vi.fn()} />);

  expect(screen.getAllByLabelText("类型")).toHaveLength(2);
  expect(screen.getAllByLabelText("标题")).toHaveLength(2);
  expect(screen.getAllByLabelText("画面目标")).toHaveLength(2);
  expect(screen.getAllByLabelText("文案")).toHaveLength(2);
  expect(screen.getAllByLabelText("场景")).toHaveLength(2);
  expect(screen.getByLabelText("第 1 张生图提示词")).toBeInTheDocument();
  expect(screen.getByLabelText("第 2 张生图提示词")).toBeInTheDocument();
});

it("does not confirm while any required plan field is blank", () => {
  const onConfirm = vi.fn();
  render(<PlanEditor analysis={{ ...analysisWithTwoItems, plan: [{ ...analysisWithTwoItems.plan[0], prompt: "" }] }} onChange={vi.fn()} onReplan={vi.fn()} onConfirm={onConfirm} />);

  expect(screen.getByRole("button", { name: "确认规划并生成" })).toBeDisabled();
});

it("requests a complete new plan", async () => {
  const onReplan = vi.fn();
  const user = userEvent.setup();
  render(<PlanEditor analysis={analysisWithTwoItems} onChange={vi.fn()} onReplan={onReplan} onConfirm={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "重新规划" }));
  expect(onReplan).toHaveBeenCalledTimes(1);
});
