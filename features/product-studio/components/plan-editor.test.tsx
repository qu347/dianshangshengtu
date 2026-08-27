import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import { PlanEditor } from "./plan-editor";
import { analysisWithTwoItems, defaultSettings } from "../test-fixtures";

const analysisWithLocalizedAnnotations = {
  ...analysisWithTwoItems,
  plan: [
    analysisWithTwoItems.plan[0],
    {
      ...analysisWithTwoItems.plan[1],
      annotations: [
        { id: "height", label: "Высота чашки", displayValue: "12 см" },
        { id: "diameter", label: "Диаметр чашки", displayValue: "8 см" },
      ],
    },
  ],
};

it("edits one prompt without changing the remaining plan items", async () => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  function Harness() {
    const [analysis, setAnalysis] = useState(analysisWithTwoItems);
    return <PlanEditor analysis={analysis} settings={defaultSettings} onChange={(nextAnalysis) => { onChange(nextAnalysis); setAnalysis(nextAnalysis); }} onReplan={vi.fn()} onConfirm={vi.fn()} />;
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

it("keeps every plan text field editable with numbered Chinese prompt labels", () => {
  render(<PlanEditor analysis={analysisWithTwoItems} settings={defaultSettings} onChange={vi.fn()} onReplan={vi.fn()} onConfirm={vi.fn()} />);

  expect(screen.getAllByLabelText("类型")).toHaveLength(2);
  for (const label of ["标题", "画面目标", "文案", "场景"]) {
    for (const field of screen.getAllByLabelText(label)) expect(field).toBeEnabled();
  }
  expect(screen.getByLabelText("第 1 张中文生图提示词")).toBeEnabled();
  expect(screen.getByLabelText("第 2 张中文生图提示词")).toBeEnabled();
});

it("shows image 2 localized dimension annotations as read-only plan details", () => {
  render(<PlanEditor analysis={analysisWithLocalizedAnnotations} settings={defaultSettings} onChange={vi.fn()} onReplan={vi.fn()} onConfirm={vi.fn()} />);

  const secondPlan = screen.getByRole("heading", { name: "第 02 张" }).closest("article");
  expect(secondPlan).not.toBeNull();
  expect(secondPlan).toHaveTextContent("尺寸标注");
  expect(secondPlan).toHaveTextContent("Высота чашки");
  expect(secondPlan).toHaveTextContent("12 см");
  expect(secondPlan).toHaveTextContent("Диаметр чашки");
  expect(secondPlan).toHaveTextContent("8 см");
  expect(screen.queryByDisplayValue("12 см")).not.toBeInTheDocument();
});

it("does not confirm while any required plan field is blank", () => {
  const onConfirm = vi.fn();
  render(<PlanEditor analysis={{ ...analysisWithTwoItems, plan: [{ ...analysisWithTwoItems.plan[0], prompt: "" }] }} settings={{ ...defaultSettings, imageCount: 1 }} onChange={vi.fn()} onReplan={vi.fn()} onConfirm={onConfirm} />);

  expect(screen.getByRole("button", { name: "确认规划并生成" })).toBeDisabled();
});

it("requests a complete new plan", async () => {
  const onReplan = vi.fn();
  const user = userEvent.setup();
  render(<PlanEditor analysis={analysisWithTwoItems} settings={defaultSettings} onChange={vi.fn()} onReplan={onReplan} onConfirm={vi.fn()} />);

  await user.click(screen.getByRole("button", { name: "重新规划" }));
  expect(onReplan).toHaveBeenCalledTimes(1);
});

it("does not confirm an edited plan that removes a fixed-image invariant", () => {
  const invalid = {
    ...analysisWithTwoItems,
    plan: [
      { ...analysisWithTwoItems.plan[0], prompt: "商品居中展示，使用浅色背景。" },
      analysisWithLocalizedAnnotations.plan[1],
    ],
  };

  render(<PlanEditor analysis={invalid} settings={defaultSettings} onChange={vi.fn()} onReplan={vi.fn()} onConfirm={vi.fn()} />);

  expect(screen.getByRole("button", { name: "确认规划并生成" })).toBeDisabled();
});
