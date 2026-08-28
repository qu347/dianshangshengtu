import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ReferenceCard } from "./reference-card";

it("offers explicit upload and generation actions before selection", async () => {
  const onUpload = vi.fn();
  const onGenerate = vi.fn();
  render(<ReferenceCard kind="model" value={null} onUpload={onUpload} onGenerate={onGenerate} onDelete={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: "上传模特图" }));
  await userEvent.click(screen.getByRole("button", { name: "AI 生成模特图" }));
  expect(onUpload).toHaveBeenCalledOnce();
  expect(onGenerate).toHaveBeenCalledOnce();
});

it("shows a selected preview with reselect and delete actions", async () => {
  const onReselect = vi.fn();
  const onDelete = vi.fn();
  render(<ReferenceCard
    kind="scene"
    value={{ id: "scene", kind: "scene", source: "generated", previewUrl: "/scene.png", downloadToken: "token" }}
    onUpload={vi.fn()}
    onGenerate={vi.fn()}
    onReselect={onReselect}
    onDelete={onDelete}
  />);
  expect(screen.getByRole("img", { name: "已选场景图" })).toHaveAttribute("src", "/scene.png");
  await userEvent.click(screen.getByRole("button", { name: "重新选择场景图" }));
  await userEvent.click(screen.getByRole("button", { name: "删除场景图" }));
  expect(onReselect).toHaveBeenCalledOnce();
  expect(onDelete).toHaveBeenCalledOnce();
});

