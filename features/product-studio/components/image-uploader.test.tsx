import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ImageUploader } from "./image-uploader";

it("reports too many files without calling onFilesChanged", async () => {
  const onFilesChanged = vi.fn();
  render(<ImageUploader files={[]} onFilesChanged={onFilesChanged} />);
  const files = Array.from({ length: 7 }, (_, i) => new File(["x"], `${i}.png`, { type: "image/png" }));

  await userEvent.upload(screen.getByLabelText("上传产品图"), files);

  expect(screen.getByRole("alert")).toHaveTextContent("最多上传 6 张");
  expect(onFilesChanged).not.toHaveBeenCalled();
});

it("renders selected files as compact thumbnails that can be removed", async () => {
  const onFilesChanged = vi.fn();
  const file = new File(["x"], "cup.png", { type: "image/png" });
  render(<ImageUploader files={[file]} onFilesChanged={onFilesChanged} />);

  expect(screen.getByRole("list", { name: "已选产品图" })).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "cup.png" })).toHaveClass("size-24");

  await userEvent.click(screen.getByRole("button", { name: "移除 cup.png" }));

  expect(onFilesChanged).toHaveBeenCalledWith([]);
});
