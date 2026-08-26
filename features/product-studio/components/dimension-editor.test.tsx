import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { vi } from "vitest";
import type { DimensionItem } from "../model";
import { DimensionEditor } from "./dimension-editor";

it("adds flexible product dimensions and a custom unit", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<DimensionEditor value={[]} imageCount={2} onChange={onChange} />);

  await user.click(screen.getByRole("button", { name: "添加尺寸项" }));

  expect(onChange).toHaveBeenCalledWith([
    expect.objectContaining({ label: "", value: 0, unit: "cm" }),
  ]);
});

it("keeps a row id stable while editing and reveals a custom unit", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState<DimensionItem[]>([{ id: "height", label: "杯高", value: 12, unit: "cm" }]);
    return <DimensionEditor value={value} imageCount={2} onChange={(next) => { onChange(next); setValue(next); }} />;
  }
  render(<Harness />);

  await user.clear(screen.getByLabelText("尺寸名称 1"));
  await user.type(screen.getByLabelText("尺寸名称 1"), "高度");
  await user.selectOptions(screen.getByLabelText("尺寸单位 1"), "custom");
  await user.type(screen.getByLabelText("自定义单位 1"), "瓶");

  expect(onChange).toHaveBeenLastCalledWith([
    expect.objectContaining({ id: "height", label: "高度", unit: "custom", customUnit: "瓶" }),
  ]);
  expect(screen.getByLabelText("自定义单位 1")).toBeInTheDocument();
});

it("shows row-specific validation and caps the editor at six rows", () => {
  const rows = Array.from({ length: 6 }, (_, index) => ({ id: String(index + 1), label: index === 0 ? "" : `尺寸 ${index + 1}`, value: index === 0 ? 0 : index, unit: "cm" as const }));
  render(<DimensionEditor value={rows} imageCount={2} onChange={vi.fn()} />);

  expect(screen.getByText("请填写尺寸名称")).toBeInTheDocument();
  expect(screen.getByText("尺寸数值必须大于 0")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "添加尺寸项" })).toBeDisabled();
});

it("shows a row-specific error when a dimension label exceeds 24 characters", () => {
  render(<DimensionEditor value={[{ id: "long-label", label: "超".repeat(25), value: 12, unit: "cm" }]} imageCount={2} onChange={vi.fn()} />);

  expect(screen.getByText("尺寸名称最多 24 个字符")).toBeInTheDocument();
});
